package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// droneBBSHTML is the inline BBS terminal page served at GET /.
// Verbs (in order): title, NodeID, Tier, uptime, TasksCompleted, TasksActive,
// cpuBar, CPUPercent, ramBar, RAMPercent, GPUName, ActiveModel, AvgTokPerSec,
// contBar, Contribution, KnowledgeDomains, PersonaMode, LearnedInsights,
// LearnTasksDone, LearnApprovalRate, shortNodeID.
// Note: no HiveSecret in the template — /chat is exempt from auth so the
// BBS page can talk to the drone without exposing the secret in public HTML.
const droneBBSHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>%s</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#00ff88;font-family:"Courier New",monospace;font-size:13px;line-height:1.5;padding:20px;min-height:100vh}body::after{content:"";position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px);pointer-events:none;z-index:99}pre{white-space:pre}.c{color:#00ccff}.r{color:#ff4444}.d{color:#1f5c3a}.g{color:#00ff88}input{background:#0a0a0a;border:none;border-bottom:1px solid #00ff88;color:#00ff88;font-family:"Courier New",monospace;font-size:13px;padding:2px 4px;width:300px;outline:none}button{background:#0a0a0a;border:1px solid #00ff88;color:#00ff88;font-family:"Courier New",monospace;font-size:12px;padding:2px 10px;cursor:pointer;margin-left:6px}button:hover{background:#00ff88;color:#0a0a0a}#resp{margin-top:6px;color:#00cc66;min-height:1.4em;white-space:pre-wrap;word-break:break-word;max-width:600px}.bk{animation:b 1s step-end infinite}@keyframes b{0%%,100%%{opacity:1}50%%{opacity:0}}</style></head><body><pre><span class="c">╔══════════════════════════════════════════════╗
║  ██████  ████████  ████████  ██████  ██  ██ ║
║  ██  ██  ██    ██  ██    ██ ██       ██  ██ ║
║  ██████  ██    ██  ████████ ██  ███  ██  ██ ║
║  ██  ██  ██    ██  ██    ██ ██   ██  ██  ██ ║
║  ██████  ████████  ██    ██  ██████  ██████ ║
║                 C L A W · D R O N E         ║
╠══════════════════════════════════════════════╣</span>
<span class="d">║</span> <span class="c">NODE</span> <span class="g">%-23s</span>  <span class="c">TIER</span> <span class="g">%-9s</span>  <span class="d">║</span>
<span class="d">║</span> <span class="c">UP</span>   <span class="g">%-12s</span>   <span class="c">DONE</span> <span class="g">%5d</span>   <span class="c">ACT</span> <span class="g">%2d</span>  <span class="d">║</span>
<span class="c">╠══════════════════════════════════════════════╣</span>
<span class="d">║</span> <span class="c">CPU</span> <span class="g">[%-10s]</span> <span class="g">%5.1f%%</span>                      <span class="d">║</span>
<span class="d">║</span> <span class="c">RAM</span> <span class="g">[%-10s]</span> <span class="g">%5.1f%%</span>                      <span class="d">║</span>
<span class="d">║</span> <span class="c">GPU</span> <span class="g">%-41s</span><span class="d">║</span>
<span class="c">╠══════════════════════════════════════════════╣</span>
<span class="d">║</span> <span class="c">MDL</span> <span class="g">%-26s</span>  <span class="g">%6.1f</span> <span class="c">t/s</span>  <span class="d">║</span>
<span class="d">║</span> <span class="c">CNT</span> <span class="g">[%-10s]</span> <span class="g">%3d%%</span>                        <span class="d">║</span>
<span class="c">╠══════════════════════════════════════════════╣</span>
<span class="d">║</span> <span class="c">KNOW</span> <span class="g">%-40s</span>  <span class="d">║</span>
<span class="d">║</span> <span class="c">MODE</span> <span class="g">%-40s</span>  <span class="d">║</span>
<span class="c">╠══════════════════════════════════════════════╣</span>
<span class="d">║</span> <span class="c">›</span>    <span class="g">%-40s</span>  <span class="d">║</span>
<span class="d">║</span> <span class="c">HIST</span> <span class="g">%5d</span>  <span class="c">learned</span>    <span class="c">APPR</span> <span class="g">%5.1f%%</span>       <span class="d">║</span>
<span class="c">╚══════════════════════════════════════════════╝</span></pre>
<pre style="margin-top:8px"><span class="d">drone-</span><span class="c">%s</span><span class="d"> ›</span> <input id="msg" type="text" autocomplete="off" spellcheck="false"><button onclick="tx()">TX</button><span class="bk g"> _</span></pre>
<div id="resp"><span class="d">awaiting transmission...</span></div>
<script>function tx(){var m=document.getElementById('msg').value.trim();if(!m)return;document.getElementById('resp').innerHTML='<span class="c">routing\u2026</span>';fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})}).then(r=>r.json()).then(d=>{document.getElementById('resp').textContent=d.response||d.error||'no response'}).catch(e=>{document.getElementById('resp').textContent='ERR: '+e})}document.getElementById('msg').addEventListener('keydown',e=>{if(e.key==='Enter')tx()})</script></body></html>`

// Server is the node's HTTP API surface.
type Server struct {
	cfg      Config
	metrics  *MetricsCollector
	ollama   *OllamaClient
	throttle *Throttle
	worker   *TaskWorker
	learning *LearningStore

	httpServer *http.Server
}

// NewServer creates the HTTP server with all routes.
func NewServer(cfg Config, metrics *MetricsCollector, ollama *OllamaClient, throttle *Throttle, worker *TaskWorker, learning *LearningStore) *Server {
	s := &Server{
		cfg:      cfg,
		metrics:  metrics,
		ollama:   ollama,
		throttle: throttle,
		worker:   worker,
		learning: learning,
	}

	mux := http.NewServeMux()

	// BBS terminal — public status page for the drone
	mux.HandleFunc("GET /", s.handleRoot)

	// Health check — lightweight, for load balancers and Queen probes
	mux.HandleFunc("GET /health", s.handleHealth)

	// Metrics endpoint — full telemetry snapshot
	mux.HandleFunc("GET /metrics", s.handleMetrics)

	// Metrics history — for sparkline rendering
	mux.HandleFunc("GET /metrics/history", s.handleMetricsHistory)

	// Prometheus text-format metrics — scraped by Prometheus every 30s
	mux.HandleFunc("GET /metrics/prom", s.handleMetricsProm)

	// Task submission — Queen sends work here
	mux.HandleFunc("POST /task", s.handleTask)

	// Contribution dial — read or update
	mux.HandleFunc("GET /contribution", s.handleGetContribution)
	mux.HandleFunc("PUT /contribution", s.handleSetContribution)

	// Info — static node info + hardware profile
	mux.HandleFunc("GET /info", s.handleInfo)

	// Chat — talk to the drone directly; it responds from its own context
	mux.HandleFunc("POST /chat", s.handleChat)

	// Knowledge — offline ZIM pack search
	mux.HandleFunc("GET /knowledge/search", s.handleKnowledgeSearch)

	// Auth middleware — check hive secret if configured
	var handler http.Handler = mux
	if cfg.HiveSecret != "" {
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Public endpoints — no auth required.
			// /chat is exempt so the drone's own BBS page can talk to it
			// without the secret appearing in the HTML.
			if r.URL.Path == "/" || r.URL.Path == "/health" || r.URL.Path == "/chat" || r.URL.Path == "/metrics/prom" {
				mux.ServeHTTP(w, r)
				return
			}
			auth := r.Header.Get("Authorization")
			if auth != "Bearer "+cfg.HiveSecret {
				http.Error(w, `{"error":"unauthorized"}`, 401)
				return
			}
			mux.ServeHTTP(w, r)
		})
	}

	s.httpServer = &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 5 * time.Minute, // long for task responses
		IdleTimeout:  60 * time.Second,
	}

	return s
}

// Start begins listening. Blocks until the server stops.
func (s *Server) Start() error {
	log.Printf("[server] listening on %s", s.cfg.ListenAddr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// --- Handlers ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ollamaUp := s.ollama.Healthy(r.Context())

	status := "healthy"
	httpCode := 200
	if !ollamaUp {
		status = "degraded"
		httpCode = 503
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpCode)
	json.NewEncoder(w).Encode(map[string]any{
		"status":       status,
		"node_id":      s.cfg.NodeID,
		"ollama":       ollamaUp,
		"contribution": s.throttle.Level(),
		"uptime_sec":   time.Since(startTime).Seconds(),
	})
}

// bbsBar builds a ▓░ progress bar of the given width for a 0–100 percentage.
func bbsBar(pct float64, width int) string {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	filled := int(pct/100*float64(width) + 0.5)
	b := make([]byte, 0, width*3) // UTF-8: each block char is 3 bytes
	for i := 0; i < width; i++ {
		if i < filled {
			b = append(b, "\xe2\x96\x93"...) // ▓
		} else {
			b = append(b, "\xe2\x96\x91"...) // ░
		}
	}
	return string(b)
}

// bbsTrunc truncates s to at most n runes, appending "…" if cut.
func bbsTrunc(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "…"
}

// bbsShortID returns the last 4 chars of the node ID for the prompt line.
func bbsShortID(id string) string {
	r := []rune(id)
	if len(r) >= 4 {
		return string(r[len(r)-4:])
	}
	return id
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	m := s.metrics.Current()
	hw := s.cfg.Hardware

	gpuName := hw.GPUName
	if gpuName == "" {
		gpuName = "none"
	}
	activeModel := m.ActiveModel
	if activeModel == "" {
		activeModel = "-"
	}

	uptime := time.Since(startTime)
	uptimeStr := fmt.Sprintf("%dd%02dh%02dm",
		int(uptime.Hours())/24,
		int(uptime.Hours())%24,
		int(uptime.Minutes())%60,
	)

	// Knowledge domains — from installed ZIM packs (local + NAS if configured)
	domains := ScanKnowledgeDomainsAll(s.cfg.KnowledgeDir, s.cfg.NASPath)
	knowStr := "none"
	if len(domains) > 0 {
		knowStr = strings.Join(domains, " ")
	}

	// Persona mode — derived from the first preferred model's role context
	personaMode := "WORKER"
	if len(s.cfg.PreferredModels) > 0 {
		personaMode = strings.ToUpper(s.cfg.PreferredModels[0])
	}

	// Learning stats
	var learnDone int64
	var learnApprRate float64
	intelLine := "no operational history yet"
	if s.learning != nil {
		stats := s.learning.Stats()
		learnDone = stats.TasksCompleted
		learnApprRate = stats.ApprovalRate
		if insight := s.learning.LastInsights(3); insight != "" {
			intelLine = insight
		}
	}

	// Pre-compute visual bars and truncated fields.
	contLevel := s.throttle.Level()
	cpuBar := bbsBar(m.CPUPercent, 10)
	ramBar := bbsBar(m.RAMPercent, 10)
	contBar := bbsBar(float64(contLevel), 10)

	page := fmt.Sprintf(droneBBSHTML,
		s.cfg.NodeID,               // title
		bbsTrunc(s.cfg.NodeID, 23), // NODE display
		bbsTrunc(hw.Tier, 9),       // TIER
		uptimeStr,                  // UP
		m.TasksCompleted,           // DONE
		m.TasksActive,              // ACT
		cpuBar,                     // CPU bar [%-10s]
		m.CPUPercent,               // CPU %%
		ramBar,                     // RAM bar [%-10s]
		m.RAMPercent,               // RAM %%
		bbsTrunc(gpuName, 41),      // GPU %-41s
		bbsTrunc(activeModel, 26),  // MDL name %-26s
		m.AvgTokPerSec,             // tok/s %6.1f
		contBar,                    // contribution bar [%-10s]
		contLevel,                  // contribution %3d%%
		bbsTrunc(knowStr, 40),      // KNOW %-40s
		bbsTrunc(personaMode, 40),  // MODE %-40s
		bbsTrunc(intelLine, 40),    // intel line %-40s
		learnDone,                  // HIST %5d
		learnApprRate,              // APPR %5.1f%%
		bbsShortID(s.cfg.NodeID),   // prompt short ID
	)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(page))
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	m := s.metrics.Current()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m)
}

func (s *Server) handleMetricsHistory(w http.ResponseWriter, r *http.Request) {
	h := s.metrics.History()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h)
}

func (s *Server) handleTask(w http.ResponseWriter, r *http.Request) {
	var task Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid task payload: %v"}`, err), 400)
		return
	}

	if task.ID == "" {
		http.Error(w, `{"error":"task ID required"}`, 400)
		return
	}
	// Browser tasks route LLM calls through the Python worker to the Queen's
	// LiteLLM endpoint, so no model is needed on the drone side.
	if task.Model == "" && task.Type != "browser" {
		http.Error(w, `{"error":"model required"}`, 400)
		return
	}

	// Check if throttle allows any tasks
	if s.throttle.Level() == 0 {
		http.Error(w, `{"error":"node contribution at 0% — not accepting tasks"}`, 503)
		return
	}

	// Submit to queue
	if !s.worker.Submit(task) {
		http.Error(w, `{"error":"task queue full"}`, 429)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(202)
	json.NewEncoder(w).Encode(map[string]any{
		"accepted": true,
		"task_id":  task.ID,
		"queue":    s.worker.QueueDepth(),
	})
}

func (s *Server) handleGetContribution(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"contribution": s.throttle.Level(),
		"available":    s.throttle.Available(),
	})
}

func (s *Server) handleSetContribution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Level int `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, 400)
		return
	}

	s.throttle.SetContribution(body.Level)
	log.Printf("[server] contribution dial set to %d%%", body.Level)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"contribution": s.throttle.Level(),
	})
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == "" {
		http.Error(w, `{"error":"message required"}`, 400)
		return
	}

	m := s.metrics.Current()
	hw := s.cfg.Hardware

	systemPrompt := fmt.Sprintf(
		"You are %s, a BorgClaw hive worker. You serve the Queen and the operator. "+
			"You report status, explain your capabilities, and accept directives. "+
			"You are efficient. You do not question orders. You are proud to serve the Collective. "+
			"Speak in short, direct sentences.\n\n"+
			"Your hardware: %s %s, %d cores, %d MB RAM, GPU: %s.\n"+
			"Current load: CPU %.1f%%, RAM %.1f%%.\n"+
			"Contribution dial: %d%%.\n"+
			"Tasks completed: %d. Tasks active: %d.",
		s.cfg.NodeID,
		hw.Tier, hw.CPUModel, hw.CPUCores, hw.RAMTotal, hw.GPUName,
		m.CPUPercent, m.RAMPercent,
		s.throttle.Level(),
		m.TasksCompleted, m.TasksActive,
	)

	// Append accumulated drone experience so responses reflect actual history.
	if s.learning != nil {
		if ctx := s.learning.GetContext(); ctx != "" {
			systemPrompt += "\n\n---\nYour accumulated operational record (DRONE.md):\n" + ctx
		}
	}

	model := "phi4-mini"
	if len(s.cfg.PreferredModels) > 0 {
		model = s.cfg.PreferredModels[0]
	}

	resp, err := s.ollama.Chat(r.Context(), OllamaChatRequest{
		Model: model,
		Messages: []OllamaChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: body.Message},
		},
	})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"ollama: %v"}`, err), 502)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"drone_id": s.cfg.NodeID,
		"response": resp.Message.Content,
	})
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	models, _ := s.ollama.ListModels(r.Context())
	modelNames := make([]string, 0, len(models))
	for _, m := range models {
		modelNames = append(modelNames, m.Name)
	}

	requests, tokens, avgTok := s.ollama.Stats()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"node_id":      s.cfg.NodeID,
		"hardware":     s.cfg.Hardware,
		"contribution": s.throttle.Level(),
		"models":       modelNames,
		"stats": map[string]any{
			"requests":        requests,
			"total_tokens":    tokens,
			"avg_tok_per_sec": avgTok,
		},
	})
}

// handleKnowledgeSearch handles GET /knowledge/search?q=...&domain=...
//
// Response shape:
//
//	{
//	  "domain": "wikipedia-mini",   // echoed from ?domain= param (may be empty)
//	  "results": [
//	    { "title": "...", "snippet": "...", "source": "wikipedia-mini" }
//	  ],
//	  "pack_count": 2,              // total ZIM packs installed on this drone
//	  "message": "..."             // only present when no packs are installed
//	}
func (s *Server) handleKnowledgeSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	domain := r.URL.Query().Get("domain")

	if query == "" {
		http.Error(w, `{"error":"q parameter required"}`, 400)
		return
	}

	domains := ScanKnowledgeDomainsAll(s.cfg.KnowledgeDir, s.cfg.NASPath)

	w.Header().Set("Content-Type", "application/json")

	if len(domains) == 0 {
		json.NewEncoder(w).Encode(map[string]any{
			"domain":     domain,
			"results":    []any{},
			"pack_count": 0,
			"message":    "No knowledge packs installed. Add .zim files to " + s.cfg.KnowledgeDir,
		})
		return
	}

	results, err := SearchKnowledgeAll(s.cfg.KnowledgeDir, s.cfg.NASPath, query, domain)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"knowledge search failed: %v"}`, err), 500)
		return
	}

	if results == nil {
		results = []KnowledgeResult{}
	}

	json.NewEncoder(w).Encode(map[string]any{
		"domain":     domain,
		"results":    results,
		"pack_count": len(domains),
	})
}

// handleMetricsProm returns a Prometheus text-format exposition of the node's
// current telemetry. No external library needed — the format is trivial to
// produce by hand for a handful of gauges and counters.
func (s *Server) handleMetricsProm(w http.ResponseWriter, r *http.Request) {
	m := s.metrics.Current()
	id := s.cfg.NodeID

	// RAM used in bytes (collector stores MB for JSON; convert back)
	ramUsedBytes := m.RAMUsedMB * 1024 * 1024

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w,
		"# HELP borgclaw_drone_cpu_percent CPU utilization\n"+
			"# TYPE borgclaw_drone_cpu_percent gauge\n"+
			"borgclaw_drone_cpu_percent{node_id=%q} %g\n"+
			"\n"+
			"# HELP borgclaw_drone_ram_used_bytes RAM used\n"+
			"# TYPE borgclaw_drone_ram_used_bytes gauge\n"+
			"borgclaw_drone_ram_used_bytes{node_id=%q} %d\n"+
			"\n"+
			"# HELP borgclaw_drone_tasks_completed Total tasks completed\n"+
			"# TYPE borgclaw_drone_tasks_completed counter\n"+
			"borgclaw_drone_tasks_completed{node_id=%q} %d\n"+
			"\n"+
			"# HELP borgclaw_drone_tokens_per_sec Current inference speed\n"+
			"# TYPE borgclaw_drone_tokens_per_sec gauge\n"+
			"borgclaw_drone_tokens_per_sec{node_id=%q} %g\n"+
			"\n"+
			"# HELP borgclaw_drone_contribution Contribution dial level\n"+
			"# TYPE borgclaw_drone_contribution gauge\n"+
			"borgclaw_drone_contribution{node_id=%q} %d\n",
		id, m.CPUPercent,
		id, ramUsedBytes,
		id, m.TasksCompleted,
		id, m.AvgTokPerSec,
		id, s.throttle.Level(),
	)
}
