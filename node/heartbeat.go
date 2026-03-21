package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"
)

// HeartbeatPayload is what the node sends to Queen every interval.
// Field names must match what Queen's /api/nodes/:nodeId/heartbeat expects.
type HeartbeatPayload struct {
	NodeID       string          `json:"node_id"`
	Addr         string          `json:"addr"`
	SentAt       time.Time       `json:"sent_at"` // For Queen RTT calculation
	Status       string          `json:"status"`  // "online", "busy", "draining"
	Hardware     HardwareProfile `json:"hardware"`
	Config       map[string]any  `json:"config,omitempty"`
	Metrics      QueenMetrics    `json:"metrics"` // Field names match Queen's expected format
	Contribution int             `json:"contribution"`
	Models       []string        `json:"models"`
	Capacity     TaskCapacity    `json:"capacity"`
}

// QueenMetrics uses field names that match Queen's server.js heartbeat handler.
type QueenMetrics struct {
	TokensPerSec   float64 `json:"tokens_per_sec"`
	CPUPct         float64 `json:"cpu_pct"`
	RAMUsedGB      float64 `json:"ram_used_gb"`
	RAMTotalGB     float64 `json:"ram_total_gb"`
	GPUUtilPct     float64 `json:"gpu_util_pct,omitempty"`
	GPUVRAMUsedMB  uint64  `json:"gpu_vram_used_mb,omitempty"`
	GPUVRAMTotalMB uint64  `json:"gpu_vram_total_mb,omitempty"`
	NetRxMbps      float64 `json:"net_rx_mbps"`
	NetTxMbps      float64 `json:"net_tx_mbps"`
	ActiveModel    string  `json:"active_model,omitempty"`
	RequestsServed int64   `json:"requests_served"`
	CPUTempC       float64 `json:"cpu_temp_c,omitempty"`
	GPUTempC       float64 `json:"gpu_temp_c,omitempty"`
}

// TaskCapacity reports how many tasks the node can handle.
type TaskCapacity struct {
	MaxSlots       int `json:"max_slots"`
	AvailableSlots int `json:"available_slots"`
	QueueDepth     int `json:"queue_depth"`
}

// HeartbeatReporter sends periodic heartbeats to Queen.
type HeartbeatReporter struct {
	queenURL      string
	nodeID        string
	advertiseAddr string
	hiveSecret    string
	interval      time.Duration

	metrics  *MetricsCollector
	ollama   *OllamaClient
	throttle *Throttle
	hardware HardwareProfile
	worker   *TaskWorker

	httpClient *http.Client
}

// NewHeartbeatReporter creates a reporter targeting the given Queen URL.
func NewHeartbeatReporter(cfg Config, metrics *MetricsCollector, ollama *OllamaClient, throttle *Throttle, worker *TaskWorker) *HeartbeatReporter {
	return &HeartbeatReporter{
		queenURL:      cfg.QueenURL,
		nodeID:        cfg.NodeID,
		advertiseAddr: cfg.AdvertiseAddr,
		hiveSecret:    cfg.HiveSecret,
		interval:   time.Duration(cfg.HeartbeatSec) * time.Second,
		metrics:    metrics,
		ollama:     ollama,
		throttle:   throttle,
		hardware:   cfg.Hardware,
		worker:     worker,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Run starts the heartbeat loop. Blocks until context is cancelled.
// Uses exponential backoff on failures, resets on success.
func (hr *HeartbeatReporter) Run(ctx context.Context) {
	var failures int
	const maxBackoff = 5 * time.Minute

	for {
		err := hr.send(ctx)
		if err != nil {
			failures++
			backoff := time.Duration(math.Min(
				float64(hr.interval)*math.Pow(1.5, float64(failures)),
				float64(maxBackoff),
			))
			log.Printf("[heartbeat] queen unreachable (attempt %d): %v — retrying in %v", failures, err, backoff)

			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
				continue
			}
		}

		// Success — reset backoff
		if failures > 0 {
			log.Printf("[heartbeat] queen connection restored after %d failures", failures)
			failures = 0
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(hr.interval):
		}
	}
}

// send transmits one heartbeat to Queen.
func (hr *HeartbeatReporter) send(ctx context.Context) error {
	ollamaUp := hr.ollama.Healthy(ctx)

	// Collect fresh metrics
	m := hr.metrics.Collect(ollamaUp)

	// Gather available models
	var modelNames []string
	if ollamaUp {
		models, err := hr.ollama.ListModels(ctx)
		if err == nil {
			for _, model := range models {
				modelNames = append(modelNames, model.Name)
			}
		}
	}

	// Determine status
	status := "online"
	if hr.throttle.Level() == 0 {
		status = "draining"
	} else if hr.throttle.Available() == 0 {
		status = "busy"
	}

	// Convert internal metrics to Queen's expected field format
	_, _, avgTok := hr.ollama.Stats()
	requests, _, _ := hr.ollama.Stats()
	queenMetrics := QueenMetrics{
		TokensPerSec:   avgTok,
		CPUPct:         m.CPUPercent,
		RAMUsedGB:      float64(m.RAMUsedMB) / 1024.0,
		RAMTotalGB:     float64(hr.hardware.RAMTotal) / 1024.0,
		GPUUtilPct:     m.GPUPercent,
		GPUVRAMTotalMB: hr.hardware.GPUVRAM,
		NetRxMbps:      m.NetRecvMB,
		NetTxMbps:      m.NetSentMB,
		ActiveModel:    m.ActiveModel,
		RequestsServed: requests,
		CPUTempC:       0, // TODO: thermal monitoring
		GPUTempC:       m.GPUTempC,
	}

	payload := HeartbeatPayload{
		NodeID:       hr.nodeID,
		Addr:         hr.advertiseAddr,
		SentAt:       time.Now(),
		Status:       status,
		Hardware:     hr.hardware,
		Metrics:      queenMetrics,
		Contribution: hr.throttle.Level(),
		Models:       modelNames,
		Capacity: TaskCapacity{
			MaxSlots:       cap(hr.throttle.semaphore),
			AvailableSlots: hr.throttle.Available(),
			QueueDepth:     hr.worker.QueueDepth(),
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal heartbeat: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", hr.queenURL+"/api/nodes/"+hr.nodeID+"/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if hr.hiveSecret != "" {
		req.Header.Set("Authorization", "Bearer "+hr.hiveSecret)
	}

	resp, err := hr.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("heartbeat POST: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 204 {
		return fmt.Errorf("queen returned %d", resp.StatusCode)
	}

	return nil
}
