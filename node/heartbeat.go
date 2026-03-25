package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"runtime"
	"time"
)

type HeartbeatPayload struct {
	NodeID           string          `json:"node_id"`
	Addr             string          `json:"addr"`
	SentAt           time.Time       `json:"sent_at"`
	Status           string          `json:"status"`
	Hardware         HardwareProfile `json:"hardware"`
	Config           map[string]any  `json:"config,omitempty"`
	Metrics          QueenMetrics    `json:"metrics"`
	Contribution     int             `json:"contribution"`
	Models           []string        `json:"models"`
	Capacity         TaskCapacity    `json:"capacity"`
	KnowledgeDomains []string        `json:"knowledge_domains"`

	Mode    string `json:"mode,omitempty"`
	RPCPort int    `json:"rpc_port,omitempty"`

	Security SecurityReport `json:"security,omitempty"`
}

type SecurityReport struct {
	GoVersion     string `json:"go_version"`
	OllamaVersion string `json:"ollama_version,omitempty"`
	UnusualPorts  []int  `json:"unusual_ports,omitempty"`
}

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

type TaskCapacity struct {
	MaxSlots       int `json:"max_slots"`
	AvailableSlots int `json:"available_slots"`
	QueueDepth     int `json:"queue_depth"`
}

type HeartbeatReporter struct {
	queenURL      string
	nodeID        string
	advertiseAddr string
	hiveSecret    string
	interval      time.Duration

	metrics      *MetricsCollector
	ollama       *OllamaClient
	throttle     *Throttle
	hardware     HardwareProfile
	worker       *TaskWorker
	learning     *LearningStore
	knowledgeDir string
	nasPath      string

	mode    string
	rpcPort int

	httpClient *http.Client
}

func NewHeartbeatReporter(cfg Config, metrics *MetricsCollector, ollama *OllamaClient, throttle *Throttle, worker *TaskWorker) *HeartbeatReporter {
	return &HeartbeatReporter{
		queenURL: cfg.QueenURL, nodeID: cfg.NodeID, advertiseAddr: cfg.AdvertiseAddr,
		hiveSecret: cfg.HiveSecret, interval: time.Duration(cfg.HeartbeatSec) * time.Second,
		metrics: metrics, ollama: ollama, throttle: throttle,
		hardware: cfg.Hardware, worker: worker,
		knowledgeDir: cfg.KnowledgeDir, nasPath: cfg.NASPath,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (hr *HeartbeatReporter) SetRPCWorkerMode(port int) {
	hr.mode = "rpc-worker"
	hr.rpcPort = port
}

func (hr *HeartbeatReporter) SetLearning(ls *LearningStore) { hr.learning = ls }

func (hr *HeartbeatReporter) TriggerNow(ctx context.Context) {
	if err := hr.send(ctx); err != nil {
		log.Printf("[heartbeat] immediate trigger failed: %v", err)
	}
}

func (hr *HeartbeatReporter) Run(ctx context.Context) {
	var failures int
	const maxBackoff = 5 * time.Minute

	for {
		if err := hr.send(ctx); err != nil {
			failures++
			backoff := time.Duration(math.Min(
				float64(hr.interval)*math.Pow(1.5, float64(failures)),
				float64(maxBackoff),
			))
			log.Printf("[heartbeat] queen unreachable (attempt %d): %v -- retrying in %v", failures, err, backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
				continue
			}
		}

		if failures > 0 {
			log.Printf("[heartbeat] queen restored after %d failures", failures)
			failures = 0
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(hr.interval):
		}
	}
}

func (hr *HeartbeatReporter) send(ctx context.Context) error {
	ollamaUp := hr.ollama.Healthy(ctx)
	m := hr.metrics.Collect(ollamaUp)

	if hr.learning != nil {
		hr.learning.UpdatePeriodic(hr.hardware, m)
	}

	var modelNames []string
	if ollamaUp {
		if models, err := hr.ollama.ListModels(ctx); err == nil {
			for _, model := range models {
				modelNames = append(modelNames, model.Name)
			}
		}
	}

	knowledgeDomains := ScanKnowledgeDomainsAll(hr.knowledgeDir, hr.nasPath)

	status := "online"
	if hr.throttle.Level() == 0 {
		status = "draining"
	} else if hr.throttle.Available() == 0 {
		status = "busy"
	}

	// Build security report
	secReport := SecurityReport{GoVersion: runtime.Version()}
	if ollamaUp {
		secReport.OllamaVersion = hr.ollama.Version(ctx)
	}

	requests, _, avgTok := hr.ollama.Stats()
	payload := HeartbeatPayload{
		NodeID: hr.nodeID, Addr: hr.advertiseAddr, SentAt: time.Now(),
		Status: status, Hardware: hr.hardware,
		Metrics: QueenMetrics{
			TokensPerSec: avgTok, CPUPct: m.CPUPercent,
			RAMUsedGB: float64(m.RAMUsedMB) / 1024.0, RAMTotalGB: float64(hr.hardware.RAMTotal) / 1024.0,
			GPUUtilPct: m.GPUPercent, GPUVRAMTotalMB: hr.hardware.GPUVRAM,
			NetRxMbps: m.NetRecvMB, NetTxMbps: m.NetSentMB,
			ActiveModel: m.ActiveModel, RequestsServed: requests,
			GPUTempC: m.GPUTempC,
		},
		Contribution: hr.throttle.Level(), Models: modelNames,
		KnowledgeDomains: knowledgeDomains,
		Capacity: TaskCapacity{
			MaxSlots: cap(hr.throttle.semaphore), AvailableSlots: hr.throttle.Available(),
			QueueDepth: hr.worker.QueueDepth(),
		},
		Mode: hr.mode, RPCPort: hr.rpcPort,
		Security: secReport,
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
