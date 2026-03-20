package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Server is the node's HTTP API surface.
type Server struct {
	cfg      Config
	metrics  *MetricsCollector
	ollama   *OllamaClient
	throttle *Throttle
	worker   *TaskWorker

	httpServer *http.Server
}

// NewServer creates the HTTP server with all routes.
func NewServer(cfg Config, metrics *MetricsCollector, ollama *OllamaClient, throttle *Throttle, worker *TaskWorker) *Server {
	s := &Server{
		cfg:      cfg,
		metrics:  metrics,
		ollama:   ollama,
		throttle: throttle,
		worker:   worker,
	}

	mux := http.NewServeMux()

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

	s.httpServer = &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      mux,
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
	if task.Model == "" {
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
