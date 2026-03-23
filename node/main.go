// BorgClaw Drone -- single-binary agent that turns any machine into a hive node.
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
	queenURL := flag.String("queen", "", "Queen service URL")
	listen := flag.String("listen", ":9091", "Listen address")
	ollamaURL := flag.String("ollama", "http://localhost:11434", "Ollama API URL")
	contribution := flag.Int("contribution", 50, "Contribution dial 0-100")
	nodeID := flag.String("id", "", "Node ID (defaults to hostname hash)")
	configPath := flag.String("config", "", "Config file path")
	heartbeatSec := flag.Int("heartbeat", 30, "Heartbeat interval seconds")
	maxConcurrent := flag.Int("concurrent", 0, "Max concurrent tasks (0=auto)")
	hiveSecret := flag.String("secret", "", "Hive secret for auth")
	printInfo := flag.Bool("info", false, "Print hardware info and exit")
	noPull := flag.Bool("no-pull", false, "Disable automatic model pulling")

	mode := flag.String("mode", "task", `"task" (Ollama) or "rpc-worker" (llama.cpp rpc-server)`)
	rpcPort := flag.Int("rpc-port", 50052, "rpc-server listen port (rpc-worker mode)")
	rpcServerBin := flag.String("rpc-server", "", "Path to rpc-server binary (rpc-worker mode)")

	flag.Parse()
	fmt.Print(banner)

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

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
	if cfg.HiveSecret == "" {
		if envSecret := os.Getenv("HIVE_SECRET"); envSecret != "" {
			cfg.HiveSecret = envSecret
		}
	}

	if *printInfo {
		printHardwareInfo(cfg)
		return
	}

	if cfg.QueenURL == "" {
		log.Println("[init] no --queen flag -- scanning LAN via mDNS (5s)...")
		if discovered := discoverQueenViaMDNS(); discovered != "" {
			cfg.QueenURL = discovered
		} else {
			fmt.Fprintln(os.Stderr, "error: Queen not found via mDNS and no --queen flag")
			fmt.Fprintln(os.Stderr, "  ./drone --queen http://192.168.1.100:9090")
			os.Exit(1)
		}
	}

	log.Printf("[init] node=%s queen=%s advertise=%s mode=%s contribution=%d%%",
		cfg.NodeID, cfg.QueenURL, cfg.AdvertiseAddr, *mode, cfg.Contribution)
	log.Printf("[init] hw: %s/%s %d cores %dMB tier=%s",
		cfg.Hardware.OS, cfg.Hardware.Arch, cfg.Hardware.CPUCores, cfg.Hardware.RAMTotal, cfg.Hardware.Tier)
	if cfg.Hardware.GPUName != "" {
		log.Printf("[init] gpu: %s (%dMB)", cfg.Hardware.GPUName, cfg.Hardware.GPUVRAM)
	}

	ollama := NewOllamaClient(cfg.OllamaURL)
	throttle := NewThrottle(cfg.Contribution, cfg.Hardware.CPUCores)
	metrics := NewMetricsCollector(60)

	configDir := filepath.Join(os.Getenv("HOME"), ".config", "borgclaw")
	learning := InitLearning(cfg.NodeID, configDir)
	log.Printf("[init] learning: %s", filepath.Join(configDir, "DRONE.md"))

	worker := NewTaskWorker(cfg.NodeID, ollama, throttle, metrics, learning, 32)
	heartbeat := NewHeartbeatReporter(cfg, metrics, ollama, throttle, worker)
	heartbeat.SetLearning(learning)
	server := NewServer(cfg, metrics, ollama, throttle, worker, learning)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	if *mode == "rpc-worker" {
		rpcW, err := NewRPCWorker(*rpcServerBin, *rpcPort)
		if err != nil {
			log.Fatalf("[rpc-worker] %v", err)
		}
		log.Printf("[rpc-worker] binary=%s port=%d", rpcW.BinaryPath(), rpcW.Port())
		heartbeat.SetRPCWorkerMode(rpcW.Port())

		go func() { _ = server.Start() }()
		go heartbeat.Run(ctx)
		go func() {
			if err := rpcW.Start(ctx); err != nil {
				log.Printf("[rpc-worker] exited: %v", err)
				cancel()
			}
		}()

		log.Printf("[init] rpc-worker online on port %d", rpcW.Port())
		sig := <-sigCh
		log.Printf("[shutdown] received %v", sig)
		cancel()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		server.Shutdown(shutdownCtx)
		log.Println("[shutdown] detached")
		return
	}

	if ollama.Healthy(context.Background()) {
		models, _ := ollama.ListModels(context.Background())
		log.Printf("[init] ollama: connected, %d models", len(models))
		for _, m := range models {
			log.Printf("[init]   %s (%.0fMB)", m.Name, float64(m.Size)/(1024*1024))
		}
	} else {
		log.Println("[init] ollama: not reachable -- node will report degraded")
	}

	go worker.Run(ctx)
	go heartbeat.Run(ctx)
	go func() { _ = server.Start() }()

	if !*noPull {
		go startModelUpdater(ctx, cfg, ollama, heartbeat)
	} else {
		log.Println("[models] --no-pull: skipping model updates")
	}

	log.Println("[init] drone online. Ctrl+C to detach.")

	sig := <-sigCh
	log.Printf("[shutdown] received %v", sig)
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	server.Shutdown(shutdownCtx)
	log.Println("[shutdown] detached")
}

func startModelUpdater(ctx context.Context, cfg Config, ollama *OllamaClient, hb *HeartbeatReporter) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Second):
	}

	toPull := EnsureOptimalModels(ollama, cfg.Hardware)
	if len(toPull) == 0 {
		log.Printf("[models] all optimal models present for tier=%s", cfg.Hardware.Tier)
		return
	}

	log.Printf("[models] %d to pull for tier=%s: %v", len(toPull), cfg.Hardware.Tier, toPull)
	for _, model := range toPull {
		select {
		case <-ctx.Done():
			return
		default:
		}
		log.Printf("[models] pulling %s...", model)
		if err := ollama.Pull(ctx, model); err != nil {
			log.Printf("[models] pull %s failed: %v", model, err)
			continue
		}
		log.Printf("[models] pulled %s", model)
		hb.TriggerNow(ctx)
	}
	log.Println("[models] update pass complete")
}

func printHardwareInfo(cfg Config) {
	hw := cfg.Hardware
	fmt.Printf("Node ID:      %s\nAdvertise:    %s\nOS/Arch:      %s/%s\nGo:           %s\n",
		cfg.NodeID, cfg.AdvertiseAddr, hw.OS, hw.Arch, runtime.Version())
	fmt.Printf("CPU:          %s (%d cores)\nRAM:          %d MB\n", hw.CPUModel, hw.CPUCores, hw.RAMTotal)
	if hw.GPUName != "" {
		fmt.Printf("GPU:          %s (%d MB)\n", hw.GPUName, hw.GPUVRAM)
	}
	fmt.Printf("Tier:         %s\nContribution: %d%%\n", hw.Tier, cfg.Contribution)

	ollama := NewOllamaClient(cfg.OllamaURL)
	if ollama.Healthy(context.Background()) {
		models, _ := ollama.ListModels(context.Background())
		fmt.Printf("Ollama:       connected (%d models)\n", len(models))
		for _, m := range models {
			fmt.Printf("  - %s (%.0f MB)\n", m.Name, float64(m.Size)/(1024*1024))
		}
	} else {
		fmt.Println("Ollama:       not reachable")
	}
}
