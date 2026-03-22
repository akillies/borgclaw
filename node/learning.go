package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
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

	// Per-model tok/s tracking: model -> full stats including min/max
	modelStats map[string]*modelAccum

	// Per-type task counting
	typeStats map[string]*typeAccum

	// Per-persona task counting: persona -> {completed, failed}
	personaStats map[string]*typeAccum

	// Hourly performance buckets: hour (0-23) -> {totalTokSec, count, thermalCount}
	hourStats map[int]*hourAccum

	// Thermal flag
	thermalEvent bool // true if CPU ever exceeded threshold

	// Insight generation cadence — generates every insightIntervalCalls UpdatePeriodic calls
	periodicCallCount  int
	insightIntervalCalls int

	// Cached insights — regenerated every 10 minutes, written to file immediately
	cachedInsights []string

	// Track high-contribution thermal correlation
	peakContributionAtThermal int
}

type modelAccum struct {
	totalTokPerSec float64
	count          int64
	minTokPerSec   float64
	maxTokPerSec   float64
	completed      int64
	failed         int64
}

type typeAccum struct {
	completed int64
	failed    int64
}

type hourAccum struct {
	totalTokPerSec float64
	count          int64
	thermalCount   int64 // how many thermal events happened in this hour
}

const thermalThresholdC = 80.0
const insightMinModelRuns = 10 // minimum runs before model insight is emitted
const insightMinPersonaTasks = 5
const insightMinHourSamples = 3

// InitLearning loads an existing DRONE.md or creates a fresh one.
// configDir is typically ~/.config/borgclaw.
func InitLearning(nodeID string, configDir string) *LearningStore {
	path := filepath.Join(configDir, "DRONE.md")

	ls := &LearningStore{
		path:                 path,
		nodeID:               nodeID,
		modelStats:           make(map[string]*modelAccum),
		typeStats:            make(map[string]*typeAccum),
		personaStats:         make(map[string]*typeAccum),
		hourStats:            make(map[int]*hourAccum),
		insightIntervalCalls: 20, // 20 × 30s = 10 minutes
	}

	// Parse any existing file so counters survive restart
	if data, err := os.ReadFile(path); err == nil {
		ls.parseExisting(string(data))
	}

	return ls
}

// RecordTaskResult is called by the worker after each task completes.
// model may be empty for browser tasks. persona may be empty for unspecified tasks.
func (ls *LearningStore) RecordTaskResult(taskType string, model string, persona string, success bool, tokPerSec float64) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	hour := time.Now().Hour()

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

	// Per-persona stats (normalize to uppercase for consistency)
	if persona != "" {
		p := strings.ToUpper(persona)
		if _, ok := ls.personaStats[p]; !ok {
			ls.personaStats[p] = &typeAccum{}
		}
		if success {
			ls.personaStats[p].completed++
		} else {
			ls.personaStats[p].failed++
		}
	}

	// Per-model tok/s (only meaningful for inference tasks with real throughput)
	if model != "" && tokPerSec > 0 {
		if _, ok := ls.modelStats[model]; !ok {
			ls.modelStats[model] = &modelAccum{
				minTokPerSec: math.MaxFloat64,
				maxTokPerSec: -math.MaxFloat64,
			}
		}
		acc := ls.modelStats[model]
		acc.totalTokPerSec += tokPerSec
		acc.count++
		if tokPerSec < acc.minTokPerSec {
			acc.minTokPerSec = tokPerSec
		}
		if tokPerSec > acc.maxTokPerSec {
			acc.maxTokPerSec = tokPerSec
		}
		if success {
			acc.completed++
		} else {
			acc.failed++
		}
	}

	// Hourly bucket — track tok/s by hour of day
	if tokPerSec > 0 {
		if _, ok := ls.hourStats[hour]; !ok {
			ls.hourStats[hour] = &hourAccum{}
		}
		ls.hourStats[hour].totalTokPerSec += tokPerSec
		ls.hourStats[hour].count++
	}

	ls.writeFile()
}

// UpdatePeriodic is called on the metrics collection cadence (every 30s).
// It writes the current hardware snapshot, checks thermal state, and generates
// insights every 10 minutes (every insightIntervalCalls calls).
func (ls *LearningStore) UpdatePeriodic(hw HardwareProfile, m NodeMetrics) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	ls.hw = hw
	ls.hwReady = true

	if m.CPUPercent >= thermalThresholdC {
		ls.thermalEvent = true
		// Record which hour thermal events occur in
		hour := time.Now().Hour()
		if _, ok := ls.hourStats[hour]; !ok {
			ls.hourStats[hour] = &hourAccum{}
		}
		ls.hourStats[hour].thermalCount++
	}

	ls.periodicCallCount++
	if ls.periodicCallCount%ls.insightIntervalCalls == 0 {
		ls.cachedInsights = ls.deriveInsights()
	}

	ls.writeFile()
}

// GetContext returns a concise self-description for injection into system prompts.
// Targets under 500 tokens — hardware summary + actionable learned insights only.
func (ls *LearningStore) GetContext() string {
	data, err := os.ReadFile(ls.path)
	if err != nil {
		return ""
	}

	// Extract only the ## Learned section to keep token count low
	content := string(data)
	learnedStart := strings.Index(content, "## Learned")
	if learnedStart == -1 {
		return content
	}

	// Also include a brief status header
	var sb strings.Builder

	// One-line status
	ls.mu.Lock()
	total := ls.totalCompleted + ls.totalFailed
	approvalRate := 0.0
	if total > 0 {
		approvalRate = float64(ls.approvals) / float64(total) * 100.0
	}
	_, _, avgTok := ls.globalAvgTok()
	nodeID := ls.nodeID
	ls.mu.Unlock()

	sb.WriteString(fmt.Sprintf("Drone %s | %d tasks | %.0f%% approval | %.1f tok/s avg\n\n",
		nodeID, total, approvalRate, avgTok))
	sb.WriteString(content[learnedStart:])

	return sb.String()
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

	// Models section — now includes min/max/success rate
	if len(ls.modelStats) > 0 {
		sb.WriteString("## Models\n")
		// Sort for stable output
		models := make([]string, 0, len(ls.modelStats))
		for m := range ls.modelStats {
			models = append(models, m)
		}
		sort.Strings(models)

		for _, model := range models {
			acc := ls.modelStats[model]
			avg := 0.0
			if acc.count > 0 {
				avg = acc.totalTokPerSec / float64(acc.count)
			}

			modelTotal := acc.completed + acc.failed
			successRate := 0.0
			if modelTotal > 0 {
				successRate = float64(acc.completed) / float64(modelTotal) * 100.0
			}

			if acc.count >= insightMinModelRuns && acc.minTokPerSec < math.MaxFloat64 {
				sb.WriteString(fmt.Sprintf("- %s: %.1f avg tok/s (range %.0f-%.0f), %.0f%% success (%d runs)\n",
					model, avg, acc.minTokPerSec, acc.maxTokPerSec, successRate, acc.count))
			} else {
				sb.WriteString(fmt.Sprintf("- %s: %.1f tok/s avg (%d runs)\n", model, avg, acc.count))
			}
		}
		sb.WriteString("\n")
	}

	// Persona section
	if len(ls.personaStats) > 0 {
		sb.WriteString("## Personas\n")
		personas := make([]string, 0, len(ls.personaStats))
		for p := range ls.personaStats {
			personas = append(personas, p)
		}
		sort.Strings(personas)

		for _, persona := range personas {
			ps := ls.personaStats[persona]
			pTotal := ps.completed + ps.failed
			pRate := 0.0
			if pTotal > 0 {
				pRate = float64(ps.completed) / float64(pTotal) * 100.0
			}
			sb.WriteString(fmt.Sprintf("- %s: %.0f%% success (%d tasks)\n", persona, pRate, pTotal))
		}
		sb.WriteString("\n")
	}

	// Task type breakdown
	if len(ls.typeStats) > 0 {
		sb.WriteString("## Task Types\n")
		types := make([]string, 0, len(ls.typeStats))
		for t := range ls.typeStats {
			types = append(types, t)
		}
		sort.Strings(types)

		for _, taskType := range types {
			ts := ls.typeStats[taskType]
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

	// Learned section — cached insights or fresh derivation if cache is empty
	sb.WriteString("## Learned\n")
	insights := ls.cachedInsights
	if len(insights) == 0 {
		insights = ls.deriveInsights()
	}
	if len(insights) == 0 {
		sb.WriteString("- Accumulating data — patterns emerge after more tasks\n")
	} else {
		for _, insight := range insights {
			sb.WriteString("- ")
			sb.WriteString(insight)
			sb.WriteString("\n")
		}
	}
	sb.WriteString("\n")

	return sb.String()
}

// deriveInsights produces actionable, data-driven observations from accumulated stats.
// Called every 10 minutes. Caller must hold ls.mu.
// Returns a slice of insight strings (without leading "- ").
func (ls *LearningStore) deriveInsights() []string {
	var out []string

	// --- Thermal ---
	if ls.thermalEvent {
		out = append(out, "CPU exceeded 80C during operation — thermal throttling possible under sustained load")
	}

	// --- Global throughput tier ---
	_, _, avg := ls.globalAvgTok()
	if avg > 0 {
		tier := inferThroughputTier(avg)
		out = append(out, fmt.Sprintf("Throughput tier: %s (%.1f tok/s global avg)", tier, avg))
	}

	// --- Per-model insights (10+ runs required) ---
	type modelEntry struct {
		name string
		avg  float64
		acc  *modelAccum
	}
	var qualified []modelEntry

	for name, acc := range ls.modelStats {
		if acc.count < insightMinModelRuns {
			continue
		}
		mAvg := acc.totalTokPerSec / float64(acc.count)
		qualified = append(qualified, modelEntry{name, mAvg, acc})
	}
	sort.Slice(qualified, func(i, j int) bool { return qualified[i].avg > qualified[j].avg })

	for _, me := range qualified {
		acc := me.acc
		mTotal := acc.completed + acc.failed
		successRate := 0.0
		if mTotal > 0 {
			successRate = float64(acc.completed) / float64(mTotal) * 100.0
		}
		minTok := acc.minTokPerSec
		maxTok := acc.maxTokPerSec
		if minTok == math.MaxFloat64 {
			minTok = 0
		}

		out = append(out, fmt.Sprintf("%s: %.0f avg tok/s (range %.0f-%.0f), %.0f%% success",
			me.name, me.avg, minTok, maxTok, successRate))
	}

	// Comparative model insight: fastest vs slowest (if 2+ qualified models)
	if len(qualified) >= 2 {
		fastest := qualified[0]
		slowest := qualified[len(qualified)-1]
		if slowest.avg > 0 {
			ratio := fastest.avg / slowest.avg
			if ratio >= 1.5 {
				out = append(out, fmt.Sprintf(
					"%s is %.1fx faster than %s on this hardware",
					fastest.name, ratio, slowest.name,
				))
			}
		}
	}

	// --- Per-persona insights (5+ tasks required) ---
	type personaEntry struct {
		name    string
		rate    float64
		total   int64
	}
	var personaList []personaEntry

	for persona, ps := range ls.personaStats {
		pTotal := ps.completed + ps.failed
		if pTotal < insightMinPersonaTasks {
			continue
		}
		rate := float64(ps.completed) / float64(pTotal) * 100.0
		personaList = append(personaList, personaEntry{persona, rate, pTotal})
	}
	sort.Slice(personaList, func(i, j int) bool { return personaList[i].name < personaList[j].name })

	for _, pe := range personaList {
		label := titleCase(pe.name)
		out = append(out, fmt.Sprintf("%s persona: %.0f%% success rate (%d tasks)", label, pe.rate, pe.total))
	}

	// Flag low-success persona as routing recommendation
	for _, pe := range personaList {
		if pe.rate < 75.0 {
			label := strings.ToLower(pe.name)
			out = append(out, fmt.Sprintf(
				"Route %s tasks to other drones — this node's %s approval rate is %.0f%%",
				label, label, pe.rate,
			))
		}
	}

	// --- Time-of-day patterns (3+ samples per hour required) ---
	type hourEntry struct {
		hour  int
		avg   float64
		count int64
	}
	var hourList []hourEntry
	for h, ha := range ls.hourStats {
		if ha.count < insightMinHourSamples {
			continue
		}
		havg := ha.totalTokPerSec / float64(ha.count)
		hourList = append(hourList, hourEntry{h, havg, ha.count})
	}
	sort.Slice(hourList, func(i, j int) bool { return hourList[i].avg > hourList[j].avg })

	if len(hourList) >= 2 {
		best := hourList[0]
		worst := hourList[len(hourList)-1]

		// Only emit if meaningful spread (>15% difference)
		if best.avg > 0 && (best.avg-worst.avg)/best.avg >= 0.15 {
			out = append(out, fmt.Sprintf(
				"Best throughput at hour %02d:00 (%.0f tok/s avg); lowest at %02d:00 (%.0f tok/s avg)",
				best.hour, best.avg, worst.hour, worst.avg,
			))
		}

		// Thermal hours — collect all hours with observed thermal events
		var thermalHours []string
		for h, ha := range ls.hourStats {
			if ha.thermalCount > 0 && ha.count >= insightMinHourSamples {
				thermalHours = append(thermalHours, fmt.Sprintf("%02d:00", h))
			}
		}
		sort.Strings(thermalHours)
		if len(thermalHours) > 0 {
			out = append(out, fmt.Sprintf(
				"Thermal events observed at %s — consider reducing contribution during these hours",
				strings.Join(thermalHours, ", "),
			))
		}
	}

	// --- Task type routing recommendations (5+ tasks, <60% success) ---
	for taskType, ts := range ls.typeStats {
		typeTotal := ts.completed + ts.failed
		if typeTotal < 5 {
			continue
		}
		failRate := float64(ts.failed) / float64(typeTotal) * 100.0
		if failRate >= 40.0 {
			out = append(out, fmt.Sprintf(
				"Route %s tasks to other drones — this node's approval rate is %.0f%%",
				taskType, 100.0-failRate,
			))
		} else if failRate >= 20.0 {
			out = append(out, fmt.Sprintf("High failure rate on %s tasks: %.0f%% (investigate)", taskType, failRate))
		}
	}

	// --- Veteran node milestone ---
	total := ls.totalCompleted + ls.totalFailed
	if total >= 100 {
		out = append(out, fmt.Sprintf("Veteran node: %d lifetime tasks processed", total))
	}

	return out
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

// titleCase returns a string with the first letter capitalized and the rest
// lowercased. Avoids the deprecated strings.Title function.
func titleCase(s string) string {
	s = strings.ToLower(s)
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
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
	var section string

	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)

		// Track which section we're in
		if strings.HasPrefix(trimmed, "## ") {
			section = strings.TrimPrefix(trimmed, "## ")
			continue
		}

		if !strings.HasPrefix(trimmed, "- ") {
			continue
		}
		trimmed = strings.TrimPrefix(trimmed, "- ")

		var i64 int64
		var f64 float64

		switch section {
		case "Performance":
			if n, _ := fmt.Sscanf(trimmed, "Tasks completed: %d", &i64); n == 1 {
				ls.totalCompleted = i64
				ls.approvals = i64
			} else if n, _ := fmt.Sscanf(trimmed, "Tasks failed: %d", &i64); n == 1 {
				ls.totalFailed = i64
			}

		case "Models":
			// New format: "phi4-mini: 28.3 avg tok/s (range 22-34), 96% success (12 runs)"
			// Old format: "phi4-mini: 28.3 tok/s avg (12 runs)"
			var model string
			var minTok, maxTok float64
			var successPct float64
			var runs int64

			if n, _ := fmt.Sscanf(trimmed, "%s %f avg tok/s (range %f-%f), %f%% success (%d runs)",
				&model, &f64, &minTok, &maxTok, &successPct, &runs); n == 6 {
				model = strings.TrimSuffix(model, ":")
				completed := int64(successPct / 100.0 * float64(runs))
				ls.modelStats[model] = &modelAccum{
					totalTokPerSec: f64 * float64(runs),
					count:          runs,
					minTokPerSec:   minTok,
					maxTokPerSec:   maxTok,
					completed:      completed,
					failed:         runs - completed,
				}
			} else if n, _ := fmt.Sscanf(trimmed, "%s %f tok/s avg (%d runs)", &model, &f64, &runs); n == 3 {
				// old format fallback
				model = strings.TrimSuffix(model, ":")
				ls.modelStats[model] = &modelAccum{
					totalTokPerSec: f64 * float64(runs),
					count:          runs,
					minTokPerSec:   math.MaxFloat64,
					maxTokPerSec:   -math.MaxFloat64,
					completed:      runs, // assume all successful for old data
				}
			}

		case "Personas":
			// "RESEARCHER: 90% success (12 tasks)"
			var persona string
			var pct float64
			var tasks int64
			if n, _ := fmt.Sscanf(trimmed, "%s %f%% success (%d tasks)", &persona, &pct, &tasks); n == 3 {
				persona = strings.TrimSuffix(persona, ":")
				completed := int64(pct / 100.0 * float64(tasks))
				ls.personaStats[persona] = &typeAccum{
					completed: completed,
					failed:    tasks - completed,
				}
			}

		case "Learned":
			// Restore thermal flag from learned section
			if strings.Contains(trimmed, "CPU exceeded 80C") {
				ls.thermalEvent = true
			}
		}
	}
}
