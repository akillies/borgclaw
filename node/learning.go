package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// LearningStore accumulates operational knowledge for this drone.
// It is the sole owner of DRONE.md on disk. All writes go through it.
// The file is the learning — no database, no side channel.
type LearningStore struct {
	mu      sync.Mutex
	path    string // absolute path to DRONE.md
	nodeID  string
	hw      HardwareProfile
	hwReady bool // true after first UpdatePeriodic call

	// Task accounting
	totalCompleted int64
	totalFailed    int64
	approvals      int64 // completed tasks that count toward approval rate

	// Per-model tok/s tracking: model -> {totalTokSec, count}
	modelStats map[string]*modelAccum

	// Per-type task counting
	typeStats map[string]*typeAccum

	// Thermal flag
	thermalEvent bool // true if CPU ever exceeded threshold
}

type modelAccum struct {
	totalTokPerSec float64
	count          int64
}

type typeAccum struct {
	completed int64
	failed    int64
}

const thermalThresholdC = 80.0

// InitLearning loads an existing DRONE.md or creates a fresh one.
// configDir is typically ~/.config/borgclaw.
func InitLearning(nodeID string, configDir string) *LearningStore {
	path := filepath.Join(configDir, "DRONE.md")

	ls := &LearningStore{
		path:       path,
		nodeID:     nodeID,
		modelStats: make(map[string]*modelAccum),
		typeStats:  make(map[string]*typeAccum),
	}

	// Parse any existing file so counters survive restart
	if data, err := os.ReadFile(path); err == nil {
		ls.parseExisting(string(data))
	}

	return ls
}

// RecordTaskResult is called by the worker after each task completes.
// model may be empty for browser tasks.
func (ls *LearningStore) RecordTaskResult(taskType string, model string, success bool, tokPerSec float64) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	if success {
		ls.totalCompleted++
		ls.approvals++
	} else {
		ls.totalFailed++
	}

	// Per-type stats
	if _, ok := ls.typeStats[taskType]; !ok {
		ls.typeStats[taskType] = &typeAccum{}
	}
	if success {
		ls.typeStats[taskType].completed++
	} else {
		ls.typeStats[taskType].failed++
	}

	// Per-model tok/s (only meaningful for inference tasks with real throughput)
	if model != "" && tokPerSec > 0 {
		if _, ok := ls.modelStats[model]; !ok {
			ls.modelStats[model] = &modelAccum{}
		}
		ls.modelStats[model].totalTokPerSec += tokPerSec
		ls.modelStats[model].count++
	}

	ls.writeFile()
}

// UpdatePeriodic is called on the metrics collection cadence (every 30s).
// It writes the current hardware snapshot and checks thermal state.
func (ls *LearningStore) UpdatePeriodic(hw HardwareProfile, m NodeMetrics) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	ls.hw = hw
	ls.hwReady = true

	if m.CPUPercent >= thermalThresholdC {
		ls.thermalEvent = true
	}

	ls.writeFile()
}

// GetContext returns the full DRONE.md content for injection into system prompts.
// Safe to call from any goroutine.
func (ls *LearningStore) GetContext() string {
	data, err := os.ReadFile(ls.path)
	if err != nil {
		return ""
	}
	return string(data)
}

// --- private ---

// writeFile renders and atomically writes DRONE.md.
// Caller must hold ls.mu.
func (ls *LearningStore) writeFile() {
	content := ls.render()

	// Atomic write via temp file
	dir := filepath.Dir(ls.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}

	tmp := ls.path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
		return
	}
	_ = os.Rename(tmp, ls.path)
}

// render builds the full DRONE.md markdown string from current state.
func (ls *LearningStore) render() string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("# DRONE.md — %s\n", ls.nodeID))
	sb.WriteString(fmt.Sprintf("Updated: %s\n\n", time.Now().UTC().Format("2006-01-02 15:04 UTC")))

	// Hardware section
	sb.WriteString("## Hardware\n")
	if ls.hwReady {
		sb.WriteString(fmt.Sprintf("- CPU: %s, %d cores\n", ls.hw.CPUModel, ls.hw.CPUCores))
		sb.WriteString(fmt.Sprintf("- RAM: %d MB\n", ls.hw.RAMTotal))
		if ls.hw.GPUName != "" {
			sb.WriteString(fmt.Sprintf("- GPU: %s\n", ls.hw.GPUName))
		} else {
			sb.WriteString("- GPU: none detected\n")
		}
		sb.WriteString(fmt.Sprintf("- Tier: %s\n", ls.hw.Tier))
		sb.WriteString(fmt.Sprintf("- OS: %s/%s\n", ls.hw.OS, ls.hw.Arch))
	} else {
		sb.WriteString("- (pending first metrics collection)\n")
	}
	sb.WriteString("\n")

	// Performance section
	total := ls.totalCompleted + ls.totalFailed
	approvalRate := 0.0
	if total > 0 {
		approvalRate = float64(ls.approvals) / float64(total) * 100.0
	}

	_, _, avgTokGlobal := ls.globalAvgTok()

	sb.WriteString("## Performance\n")
	sb.WriteString(fmt.Sprintf("- Tasks completed: %d\n", ls.totalCompleted))
	sb.WriteString(fmt.Sprintf("- Tasks failed: %d\n", ls.totalFailed))
	sb.WriteString(fmt.Sprintf("- Approval rate: %.0f%%\n", approvalRate))
	if avgTokGlobal > 0 {
		sb.WriteString(fmt.Sprintf("- Avg tok/s: %.1f\n", avgTokGlobal))
	}
	sb.WriteString("\n")

	// Models section
	if len(ls.modelStats) > 0 {
		sb.WriteString("## Models\n")
		for model, accum := range ls.modelStats {
			avg := 0.0
			if accum.count > 0 {
				avg = accum.totalTokPerSec / float64(accum.count)
			}
			sb.WriteString(fmt.Sprintf("- %s: %.1f tok/s avg (%d runs)\n", model, avg, accum.count))
		}
		sb.WriteString("\n")
	}

	// Task type breakdown
	if len(ls.typeStats) > 0 {
		sb.WriteString("## Task Types\n")
		for taskType, ts := range ls.typeStats {
			typeTotal := ts.completed + ts.failed
			typeRate := 0.0
			if typeTotal > 0 {
				typeRate = float64(ts.completed) / float64(typeTotal) * 100.0
			}
			sb.WriteString(fmt.Sprintf("- %s: %d completed, %d failed (%.0f%% success)\n",
				taskType, ts.completed, ts.failed, typeRate))
		}
		sb.WriteString("\n")
	}

	// Learned section
	sb.WriteString("## Learned\n")
	ls.writeLearnedInsights(&sb)
	sb.WriteString("\n")

	return sb.String()
}

// writeLearnedInsights derives pattern observations from accumulated stats.
// These are data-driven inferences, not LLM prose.
func (ls *LearningStore) writeLearnedInsights(sb *strings.Builder) {
	any := false

	if ls.thermalEvent {
		sb.WriteString("- CPU exceeded 80C during operation — thermal throttling possible under sustained load\n")
		any = true
	}

	// Flag best and worst model
	bestModel, bestTok := ls.bestModel()
	if bestModel != "" {
		sb.WriteString(fmt.Sprintf("- Best throughput model: %s (%.1f tok/s avg)\n", bestModel, bestTok))
		any = true
	}

	// Flag high-failure task types
	for taskType, ts := range ls.typeStats {
		typeTotal := ts.completed + ts.failed
		if typeTotal >= 5 {
			failRate := float64(ts.failed) / float64(typeTotal) * 100.0
			if failRate >= 20.0 {
				sb.WriteString(fmt.Sprintf("- High failure rate on %s tasks: %.0f%% (investigate)\n", taskType, failRate))
				any = true
			}
		}
	}

	// Flag overall performance tier based on avg tok/s
	_, _, avg := ls.globalAvgTok()
	if avg > 0 {
		tier := inferThroughputTier(avg)
		sb.WriteString(fmt.Sprintf("- Throughput tier: %s (%.1f tok/s avg)\n", tier, avg))
		any = true
	}

	total := ls.totalCompleted + ls.totalFailed
	if total >= 100 {
		sb.WriteString(fmt.Sprintf("- Veteran node: %d lifetime tasks processed\n", total))
		any = true
	}

	if !any {
		sb.WriteString("- Accumulating data — patterns emerge after more tasks\n")
	}
}

// globalAvgTok computes the weighted average tok/s across all models.
func (ls *LearningStore) globalAvgTok() (totalRuns int64, totalTok float64, avg float64) {
	for _, accum := range ls.modelStats {
		totalRuns += accum.count
		totalTok += accum.totalTokPerSec
	}
	if totalRuns > 0 {
		avg = totalTok / float64(totalRuns)
	}
	return
}

// bestModel returns the model with the highest average tok/s.
func (ls *LearningStore) bestModel() (name string, avgTok float64) {
	best := -math.MaxFloat64
	for model, accum := range ls.modelStats {
		if accum.count == 0 {
			continue
		}
		avg := accum.totalTokPerSec / float64(accum.count)
		if avg > best {
			best = avg
			name = model
			avgTok = avg
		}
	}
	return
}

// inferThroughputTier classifies tok/s into human-readable tiers.
func inferThroughputTier(avg float64) string {
	switch {
	case avg >= 50:
		return "fast"
	case avg >= 20:
		return "capable"
	case avg >= 8:
		return "moderate"
	default:
		return "slow"
	}
}

// parseExisting reads counters out of a previously written DRONE.md
// so they survive process restarts. Parsing is best-effort — if a line
// doesn't match, it is silently skipped.
func (ls *LearningStore) parseExisting(content string) {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "- ") {
			continue
		}
		line = strings.TrimPrefix(line, "- ")

		var i64 int64
		var f64 float64

		if n, _ := fmt.Sscanf(line, "Tasks completed: %d", &i64); n == 1 {
			ls.totalCompleted = i64
			ls.approvals = i64
		} else if n, _ := fmt.Sscanf(line, "Tasks failed: %d", &i64); n == 1 {
			ls.totalFailed = i64
		} else if strings.Contains(line, "CPU exceeded 80C") {
			ls.thermalEvent = true
		} else if strings.HasSuffix(line, "tok/s avg") || strings.Contains(line, "tok/s avg (") {
			// Model line: "phi4-mini: 28.3 tok/s avg (12 runs)"
			var model string
			var runs int64
			if n, _ := fmt.Sscanf(line, "%s %f tok/s avg (%d runs)", &model, &f64, &runs); n == 3 {
				model = strings.TrimSuffix(model, ":")
				ls.modelStats[model] = &modelAccum{
					totalTokPerSec: f64 * float64(runs),
					count:          runs,
				}
			}
		}
	}
}
