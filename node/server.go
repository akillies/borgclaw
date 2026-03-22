package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// droneBBSHTML is the inline BBS terminal page served at GET /.
// Verbs (in order): NodeID×2, Tier, Contribution, CPUPercent, RAMPercent,
// GPUName, ActiveModel, AvgTokPerSec, uptime, TasksCompleted, TasksActive,
// HiveSecret.
const droneBBSHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>%s</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;color:#00ff88;font-family:monospace;font-size:13px;padding:16px;min-height:100vh}pre{white-space:pre}.dim{color:#005533}.hi{color:#00ffaa}input{background:#0a0a0a;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:13px;padding:4px 8px;width:calc(100%% - 80px);outline:none}button{background:#003322;border:1px solid #00ff88;color:#00ff88;font-family:monospace;font-size:13px;padding:4px 12px;cursor:pointer;margin-left:4px}button:hover{background:#00ff88;color:#0a0a0a}#resp{margin-top:8px;color:#00cc66;min-height:1em;white-space:pre-wrap;word-break:break-word}.blink{animation:blink 1s step-end infinite}@keyframes blink{0%%,100%%{opacity:1}50%%{opacity:0}}</style></head><body data-secret="%s"><pre>
&#x250C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2510;
&#x2502;  B O R G C L A W   D R O N E   T E R M  &#x2502;
&#x2502;  NODE: <span class="hi">%-26s</span>&#x2502;
&#x2502;  TIER: %-8s  CONTRIBUTION: %3d%%        &#x2502;
&#x251C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2524;
&#x2502;  CPU  %5.1f%%   RAM  %5.1f%%                 &#x2502;
&#x2502;  GPU  %-30s&#x2502;
&#x2502;  MDL  %-22s %6.1f t/s &#x2502;
&#x251C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2524;
&#x2502;  UP   %-14s  DONE %5d  ACT %3d &#x2502;
&#x2514;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2518;
</pre><div style="margin-top:12px"><input id="msg" type="text" placeholder="transmit to drone..." autocomplete="off"><button onclick="send()">TX</button></div><div id="resp"><span class="dim">awaiting transmission<span class="blink">_</span></span></div><script>function send(){var m=document.getElementById('msg').value.trim();if(!m)return;var s=document.body.dataset.secret;document.getElementById('resp').textContent='...';fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s},body:JSON.stringify({message:m})}).then(function(r){return r.json()}).then(function(d){document.getElementById('resp').textContent=d.response||d.error||'no response'}).catch(function(e){document.getElementById('resp').textContent='ERR: '+e})}</script></body></html>`

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

	// Task submission — Queen sends work here
	mux.HandleFunc("POST /task", s.handleTask)

	// Contribution dial — read or update
	mux.HandleFunc("GET /contribution", s.handleGetContribution)
	mux.HandleFunc("PUT /contribution", s.handleSetContribution)

	// Info — static node info + hardware profile
	mux.HandleFunc("GET /info", s.handleInfo)

	// Chat — talk to the drone directly; it responds from its own context
	mux.HandleFunc("POST /chat", s.handleChat)

	// Auth middleware — check hive secret if configured
	var handler http.Handler = mux
	if cfg.HiveSecret != "" {
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Public endpoints — no auth required
			if r.URL.Path == "/" || r.URL.Path == "/health" {
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

	page := fmt.Sprintf(droneBBSHTML,
		s.cfg.NodeID,    // <title>
		s.cfg.HiveSecret, // data-secret on body (used by chat fetch)
		s.cfg.NodeID,    // NODE: display
		hw.Tier,         // TIER:
		s.throttle.Level(), // CONTRIBUTION:
		m.CPUPercent,    // CPU
		m.RAMPercent,    // RAM
		gpuName,         // GPU
		activeModel,     // MDL name
		m.AvgTokPerSec,  // tok/s
		uptimeStr,       // UP
		m.TasksCompleted, // DONE
		m.TasksActive,   // ACT
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
			"requests":       requests,
			"total_tokens":   tokens,
			"avg_tok_per_sec": avgTok,
		},
	})
}
