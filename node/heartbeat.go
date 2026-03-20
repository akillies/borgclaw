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
type HeartbeatPayload struct {
	NodeID       string          `json:"node_id"`
	Addr         string          `json:"addr"`
	Status       string          `json:"status"` // "online", "busy", "draining"
	Hardware     HardwareProfile `json:"hardware"`
	Metrics      NodeMetrics     `json:"metrics"`
	Contribution int             `json:"contribution"`
	Models       []string        `json:"models"`
	Capacity     TaskCapacity    `json:"capacity"`
}

// TaskCapacity reports how many tasks the node can handle.
type TaskCapacity struct {
	MaxSlots       int `json:"max_slots"`
	AvailableSlots int `json:"available_slots"`
	QueueDepth     int `json:"queue_depth"`
}

// HeartbeatReporter sends periodic heartbeats to Queen.
type HeartbeatReporter struct {
	queenURL   string
	nodeID     string
	listenAddr string
	interval   time.Duration

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
		queenURL:   cfg.QueenURL,
		nodeID:     cfg.NodeID,
		listenAddr: cfg.ListenAddr,
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

	payload := HeartbeatPayload{
		NodeID:       hr.nodeID,
		Addr:         hr.listenAddr,
		Status:       status,
		Hardware:     hr.hardware,
		Metrics:      m,
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

	req, err := http.NewRequestWithContext(ctx, "POST", hr.queenURL+"/api/nodes/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

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
