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

const droneBBSHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>%s</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#00ff88;font-family:"Courier New",monospace;font-size:13px;line-height:1.5;padding:20px;min-height:100vh}body::after{content:"";position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px);pointer-events:none;z-index:99}pre{white-space:pre}.c{color:#00ccff}.r{color:#ff4444}.d{color:#1f5c3a}.g{color:#00ff88}input{background:#0a0a0a;border:none;border-bottom:1px solid #00ff88;color:#00ff88;font-family:"Courier New",monospace;font-size:13px;padding:2px 4px;width:300px;outline:none}button{background:#0a0a0a;border:1px solid #00ff88;color:#00ff88;font-family:"Courier New",monospace;font-size:12px;padding:2px 10px;cursor:pointer;margin-left:6px}button:hover{background:#00ff88;color:#0a0a0a}#resp{margin-top:6px;color:#00cc66;min-height:1.4em;white-space:pre-wrap;word-break:break-word;max-width:600px}.bk{animation:b 1s step-end infinite}@keyframes b{0%%,100%%{opacity:1}50%%{opacity:0}}</style></head><body><pre><span class="c">` +
	`╔══════════════════════════════════════════════╗
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
<span class="c">╚══════════════════════════════════════════════╝</span></pre>` +
	`<pre style="margin-top:8px"><span class="d">drone-</span><span class="c">%s</span><span class="d"> ›</span> <input id="msg" type="text" autocomplete="off" spellcheck="false"><button onclick="tx()">TX</button><span class="bk g"> _</span></pre><div id="resp"><span class="d">awaiting transmission...</span></div><script>function tx(){var m=document.getElementById('msg').value.trim();if(!m)return;document.getElementById('resp').innerHTML='<span class="c">routing\u2026</span>';fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})}).then(r=>r.json()).then(d=>{document.getElementById('resp').textContent=d.response||d.error||'no response'}).catch(e=>{document.getElementById('resp').textContent='ERR: '+e})}document.getElementById('msg').addEventListener('keydown',e=>{if(e.key==='Enter')tx()})</script></body></html>`

type Server struct {
	cfg      Config
	metrics  *MetricsCollector
	ollama   *OllamaClient
	throttle *Throttle
	worker   *TaskWorker
	learning *LearningStore

	httpServer *http.Server
}

func NewServer(cfg Config, metrics *MetricsCollector, ollama *OllamaClient, throttle *Throttle, worker *TaskWorker, learning *LearningStore) *Server {
	s := &Server{
		cfg: cfg, metrics: metrics, ollama: ollama,
		throttle: throttle, worker: worker, learning: learning,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleRoot)
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("GET /metrics/history", s.handleMetricsHistory)
	mux.HandleFunc("GET /metrics/prom", s.handleMetricsProm)
	mux.HandleFunc("POST /task", s.handleTask)
	mux.HandleFunc("GET /contribution", s.handleGetContribution)
	mux.HandleFunc("PUT /contribution", s.handleSetContribution)
	mux.HandleFunc("GET /info", s.handleInfo)
	mux.HandleFunc("POST /chat", s.handleChat)
	mux.HandleFunc("GET /knowledge/search", s.handleKnowledgeSearch)

	var handler http.Handler = mux
	if cfg.HiveSecret != "" {
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/", "/health", "/chat", "/metrics/prom":
				mux.ServeHTTP(w, r)
				return
			}
			if r.Header.Get("Authorization") != "Bearer "+cfg.HiveSecret {
				http.Error(w, `{"error":"unauthorized"}`, 401)
				return
			}
			mux.ServeHTTP(w, r)
		})
	}

	s.httpServer = &http.Server{
		Addr: cfg.ListenAddr, Handler: handler,
		ReadTimeout: 10 * time.Second, WriteTimeout: 5 * time.Minute, IdleTimeout: 60 * time.Second,
	}
	return s
}

func (s *Server) Start() error {
	log.Printf("[server] listening on %s", s.cfg.ListenAddr)
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// --- Handlers ---

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ollamaUp := s.ollama.Healthy(r.Context())
	status, code := "healthy", 200
	if !ollamaUp {
		status, code = "degraded", 503
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{
		"status": status, "node_id": s.cfg.NodeID, "ollama": ollamaUp,
		"contribution": s.throttle.Level(), "uptime_sec": time.Since(startTime).Seconds(),
	})
}

func bbsBar(pct float64, width int) string {
	if pct < 0 {
		pct = 0
	} else if pct > 100 {
		pct = 100
	}
	filled := int(pct/100*float64(width) + 0.5)
	b := make([]byte, 0, width*3)
	for i := 0; i < width; i++ {
		if i < filled {
			b = append(b, "\xe2\x96\x93"...)
		} else {
			b = append(b, "\xe2\x96\x91"...)
		}
	}
	return string(b)
}

func bbsTrunc(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "\u2026"
}

func bbsShortID(id string) string {
	if len(id) >= 4 {
		return id[len(id)-4:]
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
	uptimeStr := fmt.Sprintf("%dd%02dh%02dm", int(uptime.Hours())/24, int(uptime.Hours())%24, int(uptime.Minutes())%60)

	domains := ScanKnowledgeDomainsAll(s.cfg.KnowledgeDir, s.cfg.NASPath)
	knowStr := "none"
	if len(domains) > 0 {
		knowStr = strings.Join(domains, " ")
	}

	personaMode := "WORKER"
	if len(s.cfg.PreferredModels) > 0 {
		personaMode = strings.ToUpper(s.cfg.PreferredModels[0])
	}

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

	contLevel := s.throttle.Level()
	page := fmt.Sprintf(droneBBSHTML,
		s.cfg.NodeID, bbsTrunc(s.cfg.NodeID, 23), bbsTrunc(hw.Tier, 9),
		uptimeStr, m.TasksCompleted, m.TasksActive,
		bbsBar(m.CPUPercent, 10), m.CPUPercent,
		bbsBar(m.RAMPercent, 10), m.RAMPercent,
		bbsTrunc(gpuName, 41), bbsTrunc(activeModel, 26), m.AvgTokPerSec,
		bbsBar(float64(contLevel), 10), contLevel,
		bbsTrunc(knowStr, 40), bbsTrunc(personaMode, 40),
		bbsTrunc(intelLine, 40), learnDone, learnApprRate,
		bbsShortID(s.cfg.NodeID),
	)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(page))
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.metrics.Current())
}

func (s *Server) handleMetricsHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.metrics.History())
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
	if task.Model == "" && task.Type != "browser" {
		http.Error(w, `{"error":"model required"}`, 400)
		return
	}
	if s.throttle.Level() == 0 {
		http.Error(w, `{"error":"contribution at 0%"}`, 503)
		return
	}
	if !s.worker.Submit(task) {
		http.Error(w, `{"error":"task queue full"}`, 429)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(202)
	json.NewEncoder(w).Encode(map[string]any{"accepted": true, "task_id": task.ID, "queue": s.worker.QueueDepth()})
}

func (s *Server) handleGetContribution(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"contribution": s.throttle.Level(), "available": s.throttle.Available()})
}

func (s *Server) handleSetContribution(w http.ResponseWriter, r *http.Request) {
	var body struct{ Level int `json:"level"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, 400)
		return
	}
	s.throttle.SetContribution(body.Level)
	log.Printf("[server] contribution set to %d%%", body.Level)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"contribution": s.throttle.Level()})
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	var body struct{ Message string `json:"message"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Message == "" {
		http.Error(w, `{"error":"message required"}`, 400)
		return
	}

	m := s.metrics.Current()
	hw := s.cfg.Hardware

	systemPrompt := fmt.Sprintf(
		"You are %s, a BorgClaw hive worker. You serve the Queen and the operator. "+
			"You report status, explain your capabilities, and accept directives. "+
			"You are efficient. You do not question orders. Speak in short, direct sentences.\n\n"+
			"Hardware: %s %s, %d cores, %d MB RAM, GPU: %s.\n"+
			"Load: CPU %.1f%%, RAM %.1f%%. Contribution: %d%%.\n"+
			"Tasks completed: %d. Active: %d.",
		s.cfg.NodeID, hw.Tier, hw.CPUModel, hw.CPUCores, hw.RAMTotal, hw.GPUName,
		m.CPUPercent, m.RAMPercent, s.throttle.Level(), m.TasksCompleted, m.TasksActive,
	)

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
	json.NewEncoder(w).Encode(map[string]any{"drone_id": s.cfg.NodeID, "response": resp.Message.Content})
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
		"node_id": s.cfg.NodeID, "hardware": s.cfg.Hardware, "contribution": s.throttle.Level(),
		"models": modelNames,
		"stats":  map[string]any{"requests": requests, "total_tokens": tokens, "avg_tok_per_sec": avgTok},
	})
}

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
			"domain": domain, "results": []any{}, "pack_count": 0,
			"message": "No knowledge packs installed. Add .zim files to " + s.cfg.KnowledgeDir,
		})
		return
	}

	results, err := SearchKnowledgeAll(s.cfg.KnowledgeDir, s.cfg.NASPath, query, domain)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"knowledge search: %v"}`, err), 500)
		return
	}
	if results == nil {
		results = []KnowledgeResult{}
	}
	json.NewEncoder(w).Encode(map[string]any{"domain": domain, "results": results, "pack_count": len(domains)})
}

func (s *Server) handleMetricsProm(w http.ResponseWriter, r *http.Request) {
	m := s.metrics.Current()
	id := s.cfg.NodeID
	ramUsedBytes := m.RAMUsedMB * 1024 * 1024

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w,
		"# HELP borgclaw_drone_cpu_percent CPU utilization\n"+
			"# TYPE borgclaw_drone_cpu_percent gauge\n"+
			"borgclaw_drone_cpu_percent{node_id=%q} %g\n\n"+
			"# HELP borgclaw_drone_ram_used_bytes RAM used\n"+
			"# TYPE borgclaw_drone_ram_used_bytes gauge\n"+
			"borgclaw_drone_ram_used_bytes{node_id=%q} %d\n\n"+
			"# HELP borgclaw_drone_tasks_completed Total tasks completed\n"+
			"# TYPE borgclaw_drone_tasks_completed counter\n"+
			"borgclaw_drone_tasks_completed{node_id=%q} %d\n\n"+
			"# HELP borgclaw_drone_tokens_per_sec Current inference speed\n"+
			"# TYPE borgclaw_drone_tokens_per_sec gauge\n"+
			"borgclaw_drone_tokens_per_sec{node_id=%q} %g\n\n"+
			"# HELP borgclaw_drone_contribution Contribution dial level\n"+
			"# TYPE borgclaw_drone_contribution gauge\n"+
			"borgclaw_drone_contribution{node_id=%q} %d\n",
		id, m.CPUPercent, id, ramUsedBytes, id, m.TasksCompleted,
		id, m.AvgTokPerSec, id, s.throttle.Level(),
	)
}
