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

type Config struct {
	NodeID          string          `json:"node_id"`
	QueenURL        string          `json:"queen_url"`
	ListenAddr      string          `json:"listen_addr"`
	AdvertiseAddr   string          `json:"advertise_addr"`
	OllamaURL       string          `json:"ollama_url"`
	HiveSecret      string          `json:"hive_secret"`
	Contribution    int             `json:"contribution"`
	Hardware        HardwareProfile `json:"hardware"`
	PreferredModels []string        `json:"preferred_models"`
	HeartbeatSec    int             `json:"heartbeat_sec"`
	MaxConcurrent   int             `json:"max_concurrent"`
	KnowledgeDir    string          `json:"knowledge_dir,omitempty"`
	NASPath         string          `json:"nas_path,omitempty"`
}

type HardwareProfile struct {
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	CPUModel string `json:"cpu_model"`
	CPUCores int    `json:"cpu_cores"`
	RAMTotal uint64 `json:"ram_total_mb"`
	GPUName  string `json:"gpu_name,omitempty"`
	GPUVRAM  uint64 `json:"gpu_vram_mb,omitempty"`
	Tier     string `json:"tier"`
}

func detectLANIP() string {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func droneID() string {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	hash := sha256.Sum256([]byte(hostname))
	return "drone-" + hex.EncodeToString(hash[:])[:4]
}

func DefaultConfig() Config {
	return Config{
		NodeID: droneID(), QueenURL: "http://localhost:9090",
		ListenAddr: ":9091", OllamaURL: "http://localhost:11434",
		Contribution: 50, HeartbeatSec: 30, MaxConcurrent: 2,
		PreferredModels: []string{"phi4-mini", "qwen3:8b"},
		KnowledgeDir:    filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "knowledge"),
	}
}

func LoadConfig(path string) (Config, error) {
	cfg := DefaultConfig()

	if path == "" {
		for _, c := range []string{
			"drone.json", "claw.json",
			filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "drone.json"),
			filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "claw.json"),
		} {
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

	if cfg.AdvertiseAddr == "" {
		port := strings.TrimPrefix(cfg.ListenAddr, ":")
		cfg.AdvertiseAddr = detectLANIP() + ":" + port
	}

	hw, err := DetectHardware()
	if err != nil {
		fmt.Fprintf(os.Stderr, "warn: hardware detection partial: %v\n", err)
	}
	cfg.Hardware = hw

	cfg.Contribution = clamp(cfg.Contribution, 0, 100)

	if cfg.KnowledgeDir == "" {
		cfg.KnowledgeDir = filepath.Join(os.Getenv("HOME"), ".config", "borgclaw", "knowledge")
	}
	if envNAS := os.Getenv("NAS_MOUNT_PATH"); envNAS != "" {
		cfg.NASPath = envNAS
	}

	return cfg, nil
}

func DetectHardware() (HardwareProfile, error) {
	hw := HardwareProfile{OS: runtime.GOOS, Arch: runtime.GOARCH, CPUCores: runtime.NumCPU()}

	if cpuInfo, err := cpu.Info(); err == nil && len(cpuInfo) > 0 {
		hw.CPUModel = cpuInfo[0].ModelName
	}
	vmStat, err := mem.VirtualMemory()
	if err == nil {
		hw.RAMTotal = vmStat.Total / (1024 * 1024)
	}
	hw.GPUName, hw.GPUVRAM = detectGPU()
	hw.Tier = classifyTier(hw)
	return hw, err
}

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

func detectGPULinux() (string, uint64) {
	out, err := runCommand("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits")
	if err != nil {
		return "", 0
	}
	parts := strings.SplitN(strings.TrimSpace(out), ",", 2)
	if len(parts) < 2 {
		return strings.TrimSpace(out), 0
	}
	var vram uint64
	fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &vram)
	return strings.TrimSpace(parts[0]), vram
}

func detectGPUMac() (string, uint64) {
	out, err := runCommand("system_profiler", "SPDisplaysDataType")
	if err != nil {
		return "", 0
	}
	var name string
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Chipset Model:") {
			name = strings.TrimSpace(strings.TrimPrefix(trimmed, "Chipset Model:"))
		}
	}
	if name != "" {
		if vmStat, err := mem.VirtualMemory(); err == nil {
			return name, vmStat.Total / (1024 * 1024)
		}
	}
	return name, 0
}

func classifyTier(hw HardwareProfile) string {
	switch {
	case hw.RAMTotal < 4096 || hw.CPUCores <= 2:
		return "nano"
	case hw.RAMTotal < 16384 || hw.CPUCores <= 4:
		return "edge"
	case hw.RAMTotal < 65536 || hw.CPUCores <= 16:
		return "worker"
	case hw.RAMTotal < 131072:
		return "heavy"
	default:
		return "beast"
	}
}
