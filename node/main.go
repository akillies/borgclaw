// BorgClaw Drone — Node Agent
//
// A single-binary agent that turns any machine into a BorgClaw hive node.
// It detects hardware, connects to Ollama for local LLM inference, registers
// with the Queen service, and accepts tasks from the hive.
//
// Usage:
//
//	./drone --queen http://192.168.1.100:9090
//	./drone --queen http://queen:9090 --contribution 75 --listen :9091
//	./drone --config drone.json
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

var startTime = time.Now()

const banner = `
  ╔══════════════════════════════════════╗
  ║        B O R G C L A W              ║
  ║         Drone Agent v0.1            ║
  ╚══════════════════════════════════════╝
`

func main() {
	// CLI flags
	queenURL := flag.String("queen", "", "Queen service URL (e.g. http://192.168.1.100:9090)")
	listen := flag.String("listen", ":9091", "Address to listen on for incoming tasks")
	ollamaURL := flag.String("ollama", "http://localhost:11434", "Ollama API URL")
	contribution := flag.Int("contribution", 50, "Contribution dial 0-100 (percentage of resources for hive)")
	nodeID := flag.String("id", "", "Node ID (defaults to hostname)")
	configPath := flag.String("config", "", "Path to config file (drone.json)")
	heartbeatSec := flag.Int("heartbeat", 30, "Heartbeat interval in seconds")
	maxConcurrent := flag.Int("concurrent", 0, "Max concurrent tasks (0 = auto-detect)")
	hiveSecret := flag.String("secret", "", "Hive secret for Queen authentication")
	printInfo := flag.Bool("info", false, "Print hardware info and exit")
	noPull := flag.Bool("no-pull", false, "Disable automatic model pulling (for bandwidth-constrained environments)")

	flag.Parse()

	fmt.Print(banner)

	// Load config
	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	// CLI flags override config file
	if *queenURL != "" {
		cfg.QueenURL = *queenURL
	}
	if *listen != ":9091" || cfg.ListenAddr == "" {
		cfg.ListenAddr = *listen
	}
	if *ollamaURL != "http://localhost:11434" {
		cfg.OllamaURL = *ollamaURL
	}
	if *contribution != 50 {
		cfg.Contribution = *contribution
	}
	if *nodeID != "" {
		cfg.NodeID = *nodeID
	}
	if *heartbeatSec != 30 {
		cfg.HeartbeatSec = *heartbeatSec
	}
	if *maxConcurrent > 0 {
		cfg.MaxConcurrent = *maxConcurrent
	}
	if *hiveSecret != "" {
		cfg.HiveSecret = *hiveSecret
	}
	// Also check HIVE_SECRET env var
	if cfg.HiveSecret == "" {
		if envSecret := os.Getenv("HIVE_SECRET"); envSecret != "" {
			cfg.HiveSecret = envSecret
		}
	}

	// Info mode — print hardware and exit
	if *printInfo {
		printHardwareInfo(cfg)
		return
	}

	// Auto-discover Queen via mDNS if no URL was provided
	if cfg.QueenURL == "" {
		log.Println("[init] no --queen flag — scanning LAN for Queen via mDNS (up to 5s)...")
		discovered := discoverQueenViaMDNS()
		if discovered != "" {
			cfg.QueenURL = discovered
		} else {
			fmt.Fprintln(os.Stderr, "error: Queen not found via mDNS and no --queen flag provided")
			fmt.Fprintln(os.Stderr, "")
			fmt.Fprintln(os.Stderr, "  Option 1 — specify Queen address directly:")
			fmt.Fprintln(os.Stderr, "    ./drone --queen http://192.168.1.100:9090")
			fmt.Fprintln(os.Stderr, "")
			fmt.Fprintln(os.Stderr, "  Option 2 — make sure the Queen is running on your LAN:")
			fmt.Fprintln(os.Stderr, "    cd services/queen && npm start")
			fmt.Fprintln(os.Stderr, "")
			fmt.Fprintln(os.Stderr, "  mDNS requires the Queen to have bonjour-service installed.")
			fmt.Fprintln(os.Stderr, "  On the Queen machine: npm install")
			os.Exit(1)
		}
	}

	log.Printf("[init] node_id=%s queen=%s advertise=%s ollama=%s contribution=%d%%",
		cfg.NodeID, cfg.QueenURL, cfg.AdvertiseAddr, cfg.OllamaURL, cfg.Contribution)
	log.Printf("[init] hardware: %s/%s, %d cores, %d MB RAM, tier=%s",
		cfg.Hardware.OS, cfg.Hardware.Arch, cfg.Hardware.CPUCores, cfg.Hardware.RAMTotal, cfg.Hardware.Tier)
	if cfg.Hardware.GPUName != "" {
		log.Printf("[init] gpu: %s (%d MB)", cfg.Hardware.GPUName, cfg.Hardware.GPUVRAM)
	}

	// Initialize components
	ollama := NewOllamaClient(cfg.OllamaURL)
	throttle := NewThrottle(cfg.Contribution, cfg.Hardware.CPUCores)
	metrics := NewMetricsCollector(60)

	configDir := filepath.Join(os.Getenv("HOME"), ".config", "borgclaw")
	learning := InitLearning(cfg.NodeID, configDir)
	log.Printf("[init] learning store: %s", filepath.Join(configDir, "DRONE.md"))

	worker := NewTaskWorker(cfg.NodeID, ollama, throttle, metrics, learning, 32)
	heartbeat := NewHeartbeatReporter(cfg, metrics, ollama, throttle, worker)
	heartbeat.SetLearning(learning)
	server := NewServer(cfg, metrics, ollama, throttle, worker, learning)

	// Check Ollama connectivity
	ctx := context.Background()
	if ollama.Healthy(ctx) {
		models, _ := ollama.ListModels(ctx)
		log.Printf("[init] ollama: connected, %d models available", len(models))
		for _, m := range models {
			log.Printf("[init]   - %s (%.0f MB)", m.Name, float64(m.Size)/(1024*1024))
		}
	} else {
		log.Println("[init] ollama: NOT REACHABLE — node will report degraded until Ollama starts")
	}

	// Setup graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Start all components
	go worker.Run(ctx)
	go heartbeat.Run(ctx)

	go func() {
		if err := server.Start(); err != nil {
			log.Printf("[server] stopped: %v", err)
		}
	}()

	// Background model updater — runs after the drone has joined the hive.
	// Checks which models are optimal for this tier and pulls any that are
	// missing, one at a time. Sends a heartbeat after each pull so Queen can
	// rebuild its LiteLLM routing table immediately.
	if !*noPull {
		go startModelUpdater(ctx, cfg, ollama, heartbeat)
	} else {
		log.Println("[models] --no-pull set: skipping automatic model updates")
	}

	log.Println("[init] drone online. Ctrl+C to detach from hive.")

	// Wait for shutdown signal
	sig := <-sigCh
	log.Printf("[shutdown] received %v, gracefully detaching...", sig)
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	server.Shutdown(shutdownCtx)

	log.Println("[shutdown] drone detached from hive.")
}

// startModelUpdater runs after the drone has joined the hive. It asks
// EnsureOptimalModels (modelselect.go) which models are ideal for this
// hardware tier, then pulls any that are missing — one at a time, sequentially,
// so we don't saturate the network or overwhelm Ollama. After each successful
// pull it triggers an immediate heartbeat so Queen can update its routing table.
func startModelUpdater(ctx context.Context, cfg Config, ollama *OllamaClient, hb *HeartbeatReporter) {
	// Small delay so the first heartbeat (hive join) goes out first.
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}

	// Ask modelselect.go what we should have.
	toPull := EnsureOptimalModels(ollama, cfg.Hardware)
	if len(toPull) == 0 {
		log.Printf("[models] all optimal models already present for tier=%s", cfg.Hardware.Tier)
		return
	}

	log.Printf("[models] %d model(s) to pull for tier=%s: %v", len(toPull), cfg.Hardware.Tier, toPull)

	for _, model := range toPull {
		select {
		case <-ctx.Done():
			log.Println("[models] context cancelled — stopping model pulls")
			return
		default:
		}

		log.Printf("[models] pulling %s ...", model)
		if err := ollama.Pull(ctx, model); err != nil {
			// Non-fatal: log and continue to next model.
			log.Printf("[models] pull %s failed: %v", model, err)
			continue
		}

		log.Printf("[models] pull complete: %s", model)

		// Inform Queen immediately — don't wait for the next scheduled heartbeat.
		hb.TriggerNow(ctx)
	}

	log.Println("[models] model update pass complete")
}

func printHardwareInfo(cfg Config) {
	hw := cfg.Hardware
	fmt.Printf("Node ID:      %s\n", cfg.NodeID)
	fmt.Printf("Advertise:    %s\n", cfg.AdvertiseAddr)
	fmt.Printf("OS/Arch:      %s/%s\n", hw.OS, hw.Arch)
	fmt.Printf("Go version:   %s\n", runtime.Version())
	fmt.Printf("CPU:          %s\n", hw.CPUModel)
	fmt.Printf("CPU Cores:    %d\n", hw.CPUCores)
	fmt.Printf("RAM:          %d MB\n", hw.RAMTotal)
	if hw.GPUName != "" {
		fmt.Printf("GPU:         %s\n", hw.GPUName)
		fmt.Printf("GPU VRAM:    %d MB\n", hw.GPUVRAM)
	}
	fmt.Printf("Tier:        %s\n", hw.Tier)
	fmt.Printf("Contribution: %d%%\n", cfg.Contribution)

	// Check Ollama
	ollama := NewOllamaClient(cfg.OllamaURL)
	ctx := context.Background()
	if ollama.Healthy(ctx) {
		models, _ := ollama.ListModels(ctx)
		fmt.Printf("Ollama:      connected (%d models)\n", len(models))
		for _, m := range models {
			fmt.Printf("  - %s (%.0f MB)\n", m.Name, float64(m.Size)/(1024*1024))
		}
	} else {
		fmt.Println("Ollama:      not reachable")
	}
}
