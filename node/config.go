package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

// Config holds all node configuration.
type Config struct {
	NodeID        string `json:"node_id"`
	QueenURL      string `json:"queen_url"`
	ListenAddr    string `json:"listen_addr"`
	AdvertiseAddr string `json:"advertise_addr"` // LAN IP:port — how Queen reaches this drone
	OllamaURL     string `json:"ollama_url"`
	HiveSecret    string `json:"hive_secret"` // Auth token for Queen API

	// Contribution dial: 0-100, percentage of resources to offer the hive
	Contribution int `json:"contribution"`

	// Hardware profile, auto-detected on startup
	Hardware HardwareProfile `json:"hardware"`

	// Models to prefer, in priority order
	PreferredModels []string `json:"preferred_models"`

	// Heartbeat interval in seconds
	HeartbeatSec int `json:"heartbeat_sec"`

	// Max concurrent tasks
	MaxConcurrent int `json:"max_concurrent"`
}

// HardwareProfile describes the node's compute capabilities.
type HardwareProfile struct {
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	CPUModel string `json:"cpu_model"`
	CPUCores int    `json:"cpu_cores"`
	RAMTotal uint64 `json:"ram_total_mb"`
	GPUName  string `json:"gpu_name,omitempty"`
	GPUVRAM  uint64 `json:"gpu_vram_mb,omitempty"`
	Tier     string `json:"tier"` // "nano", "edge", "worker", "heavy"
}

// detectLANIP finds the machine's LAN IP by dialing a UDP socket.
// This works on all platforms without parsing ifconfig output.
func detectLANIP() string {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	addr := conn.LocalAddr().(*net.UDPAddr)
	return addr.IP.String()
}

// droneID generates a unique "drone-XXXX" identifier based on hostname.
// Each machine gets a stable, short, distinguishable name.
func droneID() string {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	hash := sha256.Sum256([]byte(hostname))
	short := hex.EncodeToString(hash[:])[:4]
	return "drone-" + short
}

// DefaultConfig returns a config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		NodeID:        droneID(),
		QueenURL:      "http://localhost:9090",
		ListenAddr:    ":9091",
		OllamaURL:     "http://localhost:11434",
		Contribution:  50,
		HeartbeatSec:  30,
		MaxConcurrent: 2,
		PreferredModels: []string{
			"phi4-mini",
			"qwen3:8b",
		},
	}
}

// LoadConfig loads config from a JSON file, falling back to defaults.
func LoadConfig(path string) (Config, error) {
	cfg := DefaultConfig()

	if path == "" {
		// Try default locations
		candidates := []string{
			"drone.json",
			"claw.json", // backwards compat
			filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "drone.json"),
			filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "claw.json"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				path = c
				break
			}
		}
	}

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return cfg, fmt.Errorf("reading config %s: %w", path, err)
		}
		if err := json.Unmarshal(data, &cfg); err != nil {
			return cfg, fmt.Errorf("parsing config %s: %w", path, err)
		}
	}

	// Auto-detect advertise address (LAN IP + listen port)
	if cfg.AdvertiseAddr == "" {
		lanIP := detectLANIP()
		port := cfg.ListenAddr
		if strings.HasPrefix(port, ":") {
			port = port[1:]
		}
		cfg.AdvertiseAddr = lanIP + ":" + port
	}

	// Auto-detect hardware
	hw, err := DetectHardware()
	if err != nil {
		fmt.Fprintf(os.Stderr, "warn: hardware detection partial: %v\n", err)
	}
	cfg.Hardware = hw

	// Clamp contribution dial
	if cfg.Contribution < 0 {
		cfg.Contribution = 0
	}
	if cfg.Contribution > 100 {
		cfg.Contribution = 100
	}

	return cfg, nil
}

// DetectHardware probes the local machine for compute capabilities.
func DetectHardware() (HardwareProfile, error) {
	hw := HardwareProfile{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
	}

	// CPU info
	cpuInfo, err := cpu.Info()
	if err == nil && len(cpuInfo) > 0 {
		hw.CPUModel = cpuInfo[0].ModelName
	}
	hw.CPUCores = runtime.NumCPU()

	// RAM
	vmStat, err := mem.VirtualMemory()
	if err == nil {
		hw.RAMTotal = vmStat.Total / (1024 * 1024) // bytes → MB
	}

	// GPU detection (best-effort)
	hw.GPUName, hw.GPUVRAM = detectGPU()

	// Classify tier
	hw.Tier = classifyTier(hw)

	return hw, err
}

// detectGPU attempts GPU detection. Returns name and VRAM in MB.
func detectGPU() (string, uint64) {
	switch runtime.GOOS {
	case "linux":
		return detectGPULinux()
	case "darwin":
		return detectGPUMac()
	default:
		return "", 0
	}
}

// detectGPULinux tries nvidia-smi for NVIDIA GPUs.
func detectGPULinux() (string, uint64) {
	// nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits
	out, err := runCommand("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits")
	if err != nil {
		return "", 0
	}
	parts := strings.SplitN(strings.TrimSpace(out), ",", 2)
	if len(parts) < 2 {
		return strings.TrimSpace(out), 0
	}
	name := strings.TrimSpace(parts[0])
	var vram uint64
	fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &vram)
	return name, vram
}

// detectGPUMac detects Apple Silicon GPU via system_profiler.
func detectGPUMac() (string, uint64) {
	out, err := runCommand("system_profiler", "SPDisplaysDataType")
	if err != nil {
		return "", 0
	}
	lines := strings.Split(out, "\n")
	var name string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Chipset Model:") {
			name = strings.TrimPrefix(trimmed, "Chipset Model:")
			name = strings.TrimSpace(name)
		}
	}
	// Apple Silicon shares system RAM — report unified memory as GPU
	if name != "" {
		vmStat, err := mem.VirtualMemory()
		if err == nil {
			return name, vmStat.Total / (1024 * 1024)
		}
	}
	return name, 0
}

// classifyTier maps hardware to a BorgClaw tier.
func classifyTier(hw HardwareProfile) string {
	ram := hw.RAMTotal
	cores := hw.CPUCores

	switch {
	case ram < 4096 || cores <= 2:
		return "nano" // Raspberry Pi, low-end SBC
	case ram < 16384 || cores <= 4:
		return "edge" // Laptop, small desktop
	case ram < 65536 || cores <= 16:
		return "worker" // Desktop, workstation
	case ram < 131072:
		return "heavy" // Workstation, Mac Studio
	default:
		return "beast" // Multi-GPU server, 128GB+ RAM
	}
}
