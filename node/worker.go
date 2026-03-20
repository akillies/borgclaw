package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Task represents a unit of work received from Queen.
type Task struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"` // "chat", "generate", "embed"
	Model    string         `json:"model"`
	Payload  json.RawMessage `json:"payload"`
	Priority int            `json:"priority"` // 0=P0 (revenue), 3=P3 (research)
	Callback string         `json:"callback"` // URL to POST results back to
}

// TaskResult is returned to Queen after task completion.
type TaskResult struct {
	TaskID    string        `json:"task_id"`
	NodeID    string        `json:"node_id"`
	Status    string        `json:"status"` // "completed", "failed"
	Output    string        `json:"output,omitempty"`
	Error     string        `json:"error,omitempty"`
	Model     string        `json:"model"`
	Tokens    int           `json:"tokens"`
	TokPerSec float64      `json:"tok_per_sec"`
	Duration  time.Duration `json:"duration_ms"`
}

// TaskWorker manages the task queue and execution goroutines.
type TaskWorker struct {
	nodeID   string
	ollama   *OllamaClient
	throttle *Throttle
	metrics  *MetricsCollector

	queue     chan Task
	completed atomic.Int64

	mu          sync.Mutex
	activeTasks int

	httpClient *http.Client
}

// NewTaskWorker creates a worker with the given queue depth.
func NewTaskWorker(nodeID string, ollama *OllamaClient, throttle *Throttle, metrics *MetricsCollector, queueSize int) *TaskWorker {
	if queueSize <= 0 {
		queueSize = 32
	}
	return &TaskWorker{
		nodeID:     nodeID,
		ollama:     ollama,
		throttle:   throttle,
		metrics:    metrics,
		queue:      make(chan Task, queueSize),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// Submit adds a task to the queue. Returns false if queue is full.
func (tw *TaskWorker) Submit(task Task) bool {
	select {
	case tw.queue <- task:
		return true
	default:
		return false
	}
}

// QueueDepth returns current number of queued tasks.
func (tw *TaskWorker) QueueDepth() int {
	return len(tw.queue)
}

// Run starts processing tasks from the queue. Blocks until context is cancelled.
func (tw *TaskWorker) Run(ctx context.Context) {
	log.Printf("[worker] task worker started, queue capacity=%d", cap(tw.queue))

	for {
		select {
		case <-ctx.Done():
			log.Println("[worker] shutting down")
			return
		case task := <-tw.queue:
			// Acquire a throttle slot — blocks if at capacity
			if !tw.throttle.Acquire() {
				log.Printf("[worker] task %s rejected — contribution dial at 0%%", task.ID)
				tw.reportResult(ctx, task.Callback, TaskResult{
					TaskID: task.ID,
					NodeID: tw.nodeID,
					Status: "failed",
					Error:  "node contribution dial is at 0%",
				})
				continue
			}

			tw.mu.Lock()
			tw.activeTasks++
			tw.mu.Unlock()

			// Execute in goroutine so we can continue dequeuing
			go func(t Task) {
				defer tw.throttle.Release()
				defer func() {
					tw.mu.Lock()
					tw.activeTasks--
					tw.mu.Unlock()
				}()

				tw.execute(ctx, t)
			}(task)
		}
	}
}

// execute runs a single task and reports results.
func (tw *TaskWorker) execute(ctx context.Context, task Task) {
	log.Printf("[worker] executing task %s (type=%s, model=%s)", task.ID, task.Type, task.Model)
	start := time.Now()

	var result TaskResult
	result.TaskID = task.ID
	result.NodeID = tw.nodeID
	result.Model = task.Model

	// Update metrics with active model
	tw.mu.Lock()
	active := tw.activeTasks
	tw.mu.Unlock()
	_, _, avgTok := tw.ollama.Stats()
	tw.metrics.UpdateTaskStats(tw.completed.Load(), active, avgTok, task.Model)

	switch task.Type {
	case "chat":
		result = tw.executeChat(ctx, task, result)
	case "generate":
		result = tw.executeGenerate(ctx, task, result)
	default:
		result.Status = "failed"
		result.Error = fmt.Sprintf("unknown task type: %s", task.Type)
	}

	result.Duration = time.Since(start)

	if result.Status == "completed" {
		tw.completed.Add(1)
	}

	// Update metrics
	_, _, avgTokUpdated := tw.ollama.Stats()
	tw.mu.Lock()
	activeUpdated := tw.activeTasks
	tw.mu.Unlock()
	tw.metrics.UpdateTaskStats(tw.completed.Load(), activeUpdated, avgTokUpdated, "")

	log.Printf("[worker] task %s %s in %v (tokens=%d, tok/s=%.1f)",
		task.ID, result.Status, result.Duration, result.Tokens, result.TokPerSec)

	// Report back to Queen
	if task.Callback != "" {
		tw.reportResult(ctx, task.Callback, result)
	}
}

// executeChat handles chat-type tasks via Ollama.
func (tw *TaskWorker) executeChat(ctx context.Context, task Task, result TaskResult) TaskResult {
	var chatReq OllamaChatRequest
	if err := json.Unmarshal(task.Payload, &chatReq); err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("invalid chat payload: %v", err)
		return result
	}

	chatReq.Model = task.Model
	if chatReq.Options == nil {
		chatReq.Options = make(map[string]any)
	}
	chatReq.Options["num_ctx"] = tw.throttle.OllamaNumCtx(4096)

	resp, err := tw.ollama.Chat(ctx, chatReq)
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		return result
	}

	result.Status = "completed"
	result.Output = resp.Message.Content
	result.Tokens = resp.EvalCount
	if resp.EvalDur > 0 {
		result.TokPerSec = float64(resp.EvalCount) / (float64(resp.EvalDur) / 1e9)
	}
	return result
}

// executeGenerate handles generate-type tasks via Ollama.
func (tw *TaskWorker) executeGenerate(ctx context.Context, task Task, result TaskResult) TaskResult {
	var genReq OllamaGenerateRequest
	if err := json.Unmarshal(task.Payload, &genReq); err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("invalid generate payload: %v", err)
		return result
	}

	genReq.Model = task.Model
	if genReq.Options == nil {
		genReq.Options = make(map[string]any)
	}
	genReq.Options["num_ctx"] = tw.throttle.OllamaNumCtx(4096)

	resp, err := tw.ollama.Generate(ctx, genReq)
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		return result
	}

	result.Status = "completed"
	result.Output = resp.Response
	result.Tokens = resp.EvalCount
	if resp.EvalDur > 0 {
		result.TokPerSec = float64(resp.EvalCount) / (float64(resp.EvalDur) / 1e9)
	}
	return result
}

// reportResult POSTs a task result back to Queen's callback URL.
func (tw *TaskWorker) reportResult(ctx context.Context, callbackURL string, result TaskResult) {
	body, err := json.Marshal(result)
	if err != nil {
		log.Printf("[worker] failed to marshal result for task %s: %v", result.TaskID, err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, "POST", callbackURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("[worker] failed to create callback request for task %s: %v", result.TaskID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := tw.httpClient.Do(req)
	if err != nil {
		log.Printf("[worker] callback failed for task %s: %v", result.TaskID, err)
		return
	}
	resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 204 {
		log.Printf("[worker] callback returned %d for task %s", resp.StatusCode, result.TaskID)
	}
}
