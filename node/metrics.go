package main

import (
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

// NodeMetrics holds a point-in-time snapshot of system metrics.
type NodeMetrics struct {
	Timestamp   time.Time `json:"timestamp"`
	CPUPercent  float64   `json:"cpu_percent"`
	RAMUsedMB   uint64    `json:"ram_used_mb"`
	RAMPercent  float64   `json:"ram_percent"`
	DiskUsedGB  float64   `json:"disk_used_gb"`
	DiskPercent float64   `json:"disk_percent"`
	NetSentMB   float64   `json:"net_sent_mb"`
	NetRecvMB   float64   `json:"net_recv_mb"`
	GPUPercent  float64   `json:"gpu_percent,omitempty"`
	GPUTempC    float64   `json:"gpu_temp_c,omitempty"`

	// Ollama-specific
	OllamaUp       bool    `json:"ollama_up"`
	ActiveModel    string  `json:"active_model,omitempty"`
	TasksCompleted int64   `json:"tasks_completed"`
	TasksActive    int     `json:"tasks_active"`
	AvgTokPerSec   float64 `json:"avg_tok_per_sec,omitempty"`
}

// MetricsCollector gathers system metrics at regular intervals.
type MetricsCollector struct {
	mu      sync.RWMutex
	current NodeMetrics
	history []NodeMetrics // ring buffer for sparkline data

	// Mutable counters fed from task worker
	tasksCompleted int64
	tasksActive    int
	avgTokPerSec   float64
	activeModel    string

	maxHistory int
}

// NewMetricsCollector creates a collector with the given history depth.
func NewMetricsCollector(maxHistory int) *MetricsCollector {
	if maxHistory <= 0 {
		maxHistory = 60 // ~30 minutes at 30s intervals
	}
	return &MetricsCollector{
		maxHistory: maxHistory,
		history:    make([]NodeMetrics, 0, maxHistory),
	}
}

// Collect takes a single metrics snapshot.
func (mc *MetricsCollector) Collect(ollamaUp bool) NodeMetrics {
	m := NodeMetrics{
		Timestamp: time.Now(),
		OllamaUp:  ollamaUp,
	}

	// CPU — average across all cores over 500ms sample window
	percents, err := cpu.Percent(500*time.Millisecond, false)
	if err == nil && len(percents) > 0 {
		m.CPUPercent = percents[0]
	}

	// RAM
	vmStat, err := mem.VirtualMemory()
	if err == nil {
		m.RAMUsedMB = vmStat.Used / (1024 * 1024)
		m.RAMPercent = vmStat.UsedPercent
	}

	// Disk (root partition)
	diskStat, err := disk.Usage("/")
	if err == nil {
		m.DiskUsedGB = float64(diskStat.Used) / (1024 * 1024 * 1024)
		m.DiskPercent = diskStat.UsedPercent
	}

	// Network — snapshot totals (delta computed by consumer)
	netCounters, err := net.IOCounters(false)
	if err == nil && len(netCounters) > 0 {
		m.NetSentMB = float64(netCounters[0].BytesSent) / (1024 * 1024)
		m.NetRecvMB = float64(netCounters[0].BytesRecv) / (1024 * 1024)
	}

	// Inject task worker stats
	mc.mu.RLock()
	m.TasksCompleted = mc.tasksCompleted
	m.TasksActive = mc.tasksActive
	m.AvgTokPerSec = mc.avgTokPerSec
	m.ActiveModel = mc.activeModel
	mc.mu.RUnlock()

	// Store in ring buffer
	mc.mu.Lock()
	mc.current = m
	mc.history = append(mc.history, m)
	if len(mc.history) > mc.maxHistory {
		mc.history = mc.history[1:]
	}
	mc.mu.Unlock()

	return m
}

// Current returns the most recent metrics snapshot.
func (mc *MetricsCollector) Current() NodeMetrics {
	mc.mu.RLock()
	defer mc.mu.RUnlock()
	return mc.current
}

// History returns the metrics ring buffer for sparkline rendering.
func (mc *MetricsCollector) History() []NodeMetrics {
	mc.mu.RLock()
	defer mc.mu.RUnlock()
	out := make([]NodeMetrics, len(mc.history))
	copy(out, mc.history)
	return out
}

// UpdateTaskStats is called by the task worker to feed live stats.
func (mc *MetricsCollector) UpdateTaskStats(completed int64, active int, tokPerSec float64, model string) {
	mc.mu.Lock()
	mc.tasksCompleted = completed
	mc.tasksActive = active
	mc.avgTokPerSec = tokPerSec
	mc.activeModel = model
	mc.mu.Unlock()
}
