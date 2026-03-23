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
// Sole owner of DRONE.md on disk. The file is the learning.
type LearningStore struct {
	mu      sync.Mutex
	path    string
	nodeID  string
	hw      HardwareProfile
	hwReady bool

	totalCompleted int64
	totalFailed    int64
	approvals      int64

	modelStats   map[string]*modelAccum
	typeStats    map[string]*typeAccum
	personaStats map[string]*typeAccum
	hourStats    map[int]*hourAccum

	thermalEvent         bool
	periodicCallCount    int
	insightIntervalCalls int
	cachedInsights       []string
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
	thermalCount   int64
}

const (
	thermalThresholdC      = 80.0
	insightMinModelRuns    = 10
	insightMinPersonaTasks = 5
	insightMinHourSamples  = 3
)

func InitLearning(nodeID string, configDir string) *LearningStore {
	path := filepath.Join(configDir, "DRONE.md")
	ls := &LearningStore{
		path:                 path,
		nodeID:               nodeID,
		modelStats:           make(map[string]*modelAccum),
		typeStats:            make(map[string]*typeAccum),
		personaStats:         make(map[string]*typeAccum),
		hourStats:            make(map[int]*hourAccum),
		insightIntervalCalls: 20,
	}
	if data, err := os.ReadFile(path); err == nil {
		ls.parseExisting(string(data))
	}
	return ls
}

func (ls *LearningStore) RecordTaskResult(taskType, model, persona string, success bool, tokPerSec float64) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	hour := time.Now().Hour()

	if success {
		ls.totalCompleted++
		ls.approvals++
	} else {
		ls.totalFailed++
	}

	incrTypeAccum(ls.typeStats, taskType, success)

	if persona != "" {
		incrTypeAccum(ls.personaStats, strings.ToUpper(persona), success)
	}

	if model != "" && tokPerSec > 0 {
		acc, ok := ls.modelStats[model]
		if !ok {
			acc = &modelAccum{minTokPerSec: math.MaxFloat64, maxTokPerSec: -math.MaxFloat64}
			ls.modelStats[model] = acc
		}
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

	if tokPerSec > 0 {
		ha := ls.getHourAccum(hour)
		ha.totalTokPerSec += tokPerSec
		ha.count++
	}

	ls.writeFile()
}

func (ls *LearningStore) UpdatePeriodic(hw HardwareProfile, m NodeMetrics) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	ls.hw = hw
	ls.hwReady = true

	if m.CPUPercent >= thermalThresholdC {
		ls.thermalEvent = true
		ls.getHourAccum(time.Now().Hour()).thermalCount++
	}

	ls.periodicCallCount++
	if ls.periodicCallCount%ls.insightIntervalCalls == 0 {
		ls.cachedInsights = ls.deriveInsights()
	}

	ls.writeFile()
}

// GetContext returns a concise self-description for system prompt injection.
func (ls *LearningStore) GetContext() string {
	data, err := os.ReadFile(ls.path)
	if err != nil {
		return ""
	}
	content := string(data)
	idx := strings.Index(content, "## Learned")
	if idx == -1 {
		return content
	}

	ls.mu.Lock()
	total := ls.totalCompleted + ls.totalFailed
	rate := pctSafe(ls.approvals, total)
	_, _, avgTok := ls.globalAvgTok()
	nodeID := ls.nodeID
	ls.mu.Unlock()

	return fmt.Sprintf("Drone %s | %d tasks | %.0f%% approval | %.1f tok/s avg\n\n%s", nodeID, total, rate, avgTok, content[idx:])
}

type LearningStats struct {
	TasksCompleted int64
	ApprovalRate   float64
}

func (ls *LearningStore) Stats() LearningStats {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	total := ls.totalCompleted + ls.totalFailed
	return LearningStats{TasksCompleted: ls.totalCompleted, ApprovalRate: pctSafe(ls.approvals, total)}
}

func (ls *LearningStore) LastInsights(n int) string {
	ctx := ls.GetContext()
	if ctx == "" {
		return ""
	}
	lines := strings.Split(ctx, "\n")
	var out []string
	for i := len(lines) - 1; i >= 0 && len(out) < n; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" && !strings.HasPrefix(line, "#") {
			out = append([]string{line}, out...)
		}
	}
	return strings.Join(out, " | ")
}

// --- helpers ---

func incrTypeAccum(m map[string]*typeAccum, key string, success bool) {
	ta, ok := m[key]
	if !ok {
		ta = &typeAccum{}
		m[key] = ta
	}
	if success {
		ta.completed++
	} else {
		ta.failed++
	}
}

func (ls *LearningStore) getHourAccum(hour int) *hourAccum {
	ha, ok := ls.hourStats[hour]
	if !ok {
		ha = &hourAccum{}
		ls.hourStats[hour] = ha
	}
	return ha
}

func pctSafe(numerator, denominator int64) float64 {
	if denominator <= 0 {
		return 0
	}
	return float64(numerator) / float64(denominator) * 100.0
}

func (ls *LearningStore) globalAvgTok() (int64, float64, float64) {
	var totalRuns int64
	var totalTok float64
	for _, a := range ls.modelStats {
		totalRuns += a.count
		totalTok += a.totalTokPerSec
	}
	if totalRuns > 0 {
		return totalRuns, totalTok, totalTok / float64(totalRuns)
	}
	return 0, 0, 0
}

func sortedKeys(m map[string]*typeAccum) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// --- file I/O ---

func (ls *LearningStore) writeFile() {
	dir := filepath.Dir(ls.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	tmp := ls.path + ".tmp"
	if err := os.WriteFile(tmp, []byte(ls.render()), 0644); err != nil {
		return
	}
	_ = os.Rename(tmp, ls.path)
}

func (ls *LearningStore) render() string {
	var sb strings.Builder
	total := ls.totalCompleted + ls.totalFailed
	approvalRate := pctSafe(ls.approvals, total)
	_, _, avgTokGlobal := ls.globalAvgTok()

	fmt.Fprintf(&sb, "# DRONE.md -- %s\nUpdated: %s\n\n", ls.nodeID, time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	sb.WriteString("## Hardware\n")
	if ls.hwReady {
		fmt.Fprintf(&sb, "- CPU: %s, %d cores\n- RAM: %d MB\n", ls.hw.CPUModel, ls.hw.CPUCores, ls.hw.RAMTotal)
		if ls.hw.GPUName != "" {
			fmt.Fprintf(&sb, "- GPU: %s\n", ls.hw.GPUName)
		} else {
			sb.WriteString("- GPU: none detected\n")
		}
		fmt.Fprintf(&sb, "- Tier: %s\n- OS: %s/%s\n", ls.hw.Tier, ls.hw.OS, ls.hw.Arch)
	} else {
		sb.WriteString("- (pending first metrics collection)\n")
	}
	sb.WriteByte('\n')

	sb.WriteString("## Performance\n")
	fmt.Fprintf(&sb, "- Tasks completed: %d\n- Tasks failed: %d\n- Approval rate: %.0f%%\n", ls.totalCompleted, ls.totalFailed, approvalRate)
	if avgTokGlobal > 0 {
		fmt.Fprintf(&sb, "- Avg tok/s: %.1f\n", avgTokGlobal)
	}
	sb.WriteByte('\n')

	if len(ls.modelStats) > 0 {
		sb.WriteString("## Models\n")
		models := make([]string, 0, len(ls.modelStats))
		for m := range ls.modelStats {
			models = append(models, m)
		}
		sort.Strings(models)
		for _, name := range models {
			acc := ls.modelStats[name]
			avg := 0.0
			if acc.count > 0 {
				avg = acc.totalTokPerSec / float64(acc.count)
			}
			mTotal := acc.completed + acc.failed
			if acc.count >= insightMinModelRuns && acc.minTokPerSec < math.MaxFloat64 {
				fmt.Fprintf(&sb, "- %s: %.1f avg tok/s (range %.0f-%.0f), %.0f%% success (%d runs)\n",
					name, avg, acc.minTokPerSec, acc.maxTokPerSec, pctSafe(acc.completed, mTotal), acc.count)
			} else {
				fmt.Fprintf(&sb, "- %s: %.1f tok/s avg (%d runs)\n", name, avg, acc.count)
			}
		}
		sb.WriteByte('\n')
	}

	if len(ls.personaStats) > 0 {
		sb.WriteString("## Personas\n")
		for _, persona := range sortedKeys(ls.personaStats) {
			ps := ls.personaStats[persona]
			pTotal := ps.completed + ps.failed
			fmt.Fprintf(&sb, "- %s: %.0f%% success (%d tasks)\n", persona, pctSafe(ps.completed, pTotal), pTotal)
		}
		sb.WriteByte('\n')
	}

	if len(ls.typeStats) > 0 {
		sb.WriteString("## Task Types\n")
		for _, taskType := range sortedKeys(ls.typeStats) {
			ts := ls.typeStats[taskType]
			tTotal := ts.completed + ts.failed
			fmt.Fprintf(&sb, "- %s: %d completed, %d failed (%.0f%% success)\n",
				taskType, ts.completed, ts.failed, pctSafe(ts.completed, tTotal))
		}
		sb.WriteByte('\n')
	}

	sb.WriteString("## Learned\n")
	insights := ls.cachedInsights
	if len(insights) == 0 {
		insights = ls.deriveInsights()
	}
	if len(insights) == 0 {
		sb.WriteString("- Accumulating data -- patterns emerge after more tasks\n")
	} else {
		for _, insight := range insights {
			sb.WriteString("- ")
			sb.WriteString(insight)
			sb.WriteByte('\n')
		}
	}
	sb.WriteByte('\n')
	return sb.String()
}

// --- insight derivation ---

func (ls *LearningStore) deriveInsights() []string {
	var out []string

	if ls.thermalEvent {
		out = append(out, "CPU exceeded 80C during operation -- thermal throttling possible under sustained load")
	}

	_, _, avg := ls.globalAvgTok()
	if avg > 0 {
		tier := "slow"
		switch {
		case avg >= 50:
			tier = "fast"
		case avg >= 20:
			tier = "capable"
		case avg >= 8:
			tier = "moderate"
		}
		out = append(out, fmt.Sprintf("Throughput tier: %s (%.1f tok/s global avg)", tier, avg))
	}

	type modelEntry struct {
		name string
		avg  float64
		acc  *modelAccum
	}
	var qualified []modelEntry
	for name, acc := range ls.modelStats {
		if acc.count >= insightMinModelRuns {
			qualified = append(qualified, modelEntry{name, acc.totalTokPerSec / float64(acc.count), acc})
		}
	}
	sort.Slice(qualified, func(i, j int) bool { return qualified[i].avg > qualified[j].avg })

	for _, me := range qualified {
		acc := me.acc
		mTotal := acc.completed + acc.failed
		minTok := acc.minTokPerSec
		if minTok == math.MaxFloat64 {
			minTok = 0
		}
		out = append(out, fmt.Sprintf("%s: %.0f avg tok/s (range %.0f-%.0f), %.0f%% success",
			me.name, me.avg, minTok, acc.maxTokPerSec, pctSafe(acc.completed, mTotal)))
	}

	if len(qualified) >= 2 {
		fastest, slowest := qualified[0], qualified[len(qualified)-1]
		if slowest.avg > 0 {
			if ratio := fastest.avg / slowest.avg; ratio >= 1.5 {
				out = append(out, fmt.Sprintf("%s is %.1fx faster than %s on this hardware", fastest.name, ratio, slowest.name))
			}
		}
	}

	for _, persona := range sortedKeys(ls.personaStats) {
		ps := ls.personaStats[persona]
		pTotal := ps.completed + ps.failed
		if pTotal < insightMinPersonaTasks {
			continue
		}
		rate := pctSafe(ps.completed, pTotal)
		label := strings.ToUpper(persona[:1]) + strings.ToLower(persona[1:])
		out = append(out, fmt.Sprintf("%s persona: %.0f%% success rate (%d tasks)", label, rate, pTotal))
		if rate < 75.0 {
			l := strings.ToLower(persona)
			out = append(out, fmt.Sprintf("Route %s tasks to other drones -- this node's %s approval rate is %.0f%%", l, l, rate))
		}
	}

	type hourEntry struct {
		hour int
		avg  float64
	}
	var hourList []hourEntry
	for h, ha := range ls.hourStats {
		if ha.count >= insightMinHourSamples {
			hourList = append(hourList, hourEntry{h, ha.totalTokPerSec / float64(ha.count)})
		}
	}
	sort.Slice(hourList, func(i, j int) bool { return hourList[i].avg > hourList[j].avg })

	if len(hourList) >= 2 {
		best, worst := hourList[0], hourList[len(hourList)-1]
		if best.avg > 0 && (best.avg-worst.avg)/best.avg >= 0.15 {
			out = append(out, fmt.Sprintf("Best throughput at hour %02d:00 (%.0f tok/s avg); lowest at %02d:00 (%.0f tok/s avg)",
				best.hour, best.avg, worst.hour, worst.avg))
		}
		var thermalHours []string
		for h, ha := range ls.hourStats {
			if ha.thermalCount > 0 && ha.count >= insightMinHourSamples {
				thermalHours = append(thermalHours, fmt.Sprintf("%02d:00", h))
			}
		}
		sort.Strings(thermalHours)
		if len(thermalHours) > 0 {
			out = append(out, fmt.Sprintf("Thermal events observed at %s -- consider reducing contribution during these hours",
				strings.Join(thermalHours, ", ")))
		}
	}

	for taskType, ts := range ls.typeStats {
		typeTotal := ts.completed + ts.failed
		if typeTotal < 5 {
			continue
		}
		failRate := float64(ts.failed) / float64(typeTotal) * 100.0
		if failRate >= 40.0 {
			out = append(out, fmt.Sprintf("Route %s tasks to other drones -- this node's approval rate is %.0f%%", taskType, 100.0-failRate))
		} else if failRate >= 20.0 {
			out = append(out, fmt.Sprintf("High failure rate on %s tasks: %.0f%% (investigate)", taskType, failRate))
		}
	}

	if total := ls.totalCompleted + ls.totalFailed; total >= 100 {
		out = append(out, fmt.Sprintf("Veteran node: %d lifetime tasks processed", total))
	}

	return out
}

// --- parse existing DRONE.md ---

func (ls *LearningStore) parseExisting(content string) {
	var section string
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
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
			var model string
			var minTok, maxTok, successPct float64
			var runs int64
			if n, _ := fmt.Sscanf(trimmed, "%s %f avg tok/s (range %f-%f), %f%% success (%d runs)",
				&model, &f64, &minTok, &maxTok, &successPct, &runs); n == 6 {
				model = strings.TrimSuffix(model, ":")
				completed := int64(successPct / 100.0 * float64(runs))
				ls.modelStats[model] = &modelAccum{
					totalTokPerSec: f64 * float64(runs), count: runs,
					minTokPerSec: minTok, maxTokPerSec: maxTok,
					completed: completed, failed: runs - completed,
				}
			} else if n, _ := fmt.Sscanf(trimmed, "%s %f tok/s avg (%d runs)", &model, &f64, &runs); n == 3 {
				model = strings.TrimSuffix(model, ":")
				ls.modelStats[model] = &modelAccum{
					totalTokPerSec: f64 * float64(runs), count: runs,
					minTokPerSec: math.MaxFloat64, maxTokPerSec: -math.MaxFloat64,
					completed: runs,
				}
			}
		case "Personas":
			var persona string
			var pct float64
			var tasks int64
			if n, _ := fmt.Sscanf(trimmed, "%s %f%% success (%d tasks)", &persona, &pct, &tasks); n == 3 {
				persona = strings.TrimSuffix(persona, ":")
				completed := int64(pct / 100.0 * float64(tasks))
				ls.personaStats[persona] = &typeAccum{completed: completed, failed: tasks - completed}
			}
		case "Learned":
			if strings.Contains(trimmed, "CPU exceeded 80C") {
				ls.thermalEvent = true
			}
		}
	}
}
