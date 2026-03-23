package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

type Task struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Model    string          `json:"model"`
	Payload  json.RawMessage `json:"payload"`
	Priority int             `json:"priority"`
	Callback string          `json:"callback"`
	Persona  string          `json:"persona"`
}

type BrowserPayload struct {
	Goal       string `json:"goal"`
	QueenURL   string `json:"queen_url"`
	HiveSecret string `json:"hive_secret,omitempty"`
	MaxSteps   int    `json:"max_steps,omitempty"`
	Timeout    int    `json:"timeout,omitempty"`
	Model      string `json:"model,omitempty"`
}

type TaskResult struct {
	TaskID    string        `json:"task_id"`
	NodeID    string        `json:"node_id"`
	Status    string        `json:"status"`
	Output    string        `json:"output,omitempty"`
	Error     string        `json:"error,omitempty"`
	Model     string        `json:"model"`
	Tokens    int           `json:"tokens"`
	TokPerSec float64       `json:"tok_per_sec"`
	Duration  time.Duration `json:"duration_ms"`
}

type TaskWorker struct {
	nodeID   string
	ollama   *OllamaClient
	throttle *Throttle
	metrics  *MetricsCollector
	learning *LearningStore

	queue     chan Task
	completed atomic.Int64

	mu          sync.Mutex
	activeTasks int

	httpClient *http.Client
}

func NewTaskWorker(nodeID string, ollama *OllamaClient, throttle *Throttle, metrics *MetricsCollector, learning *LearningStore, queueSize int) *TaskWorker {
	if queueSize <= 0 {
		queueSize = 32
	}
	return &TaskWorker{
		nodeID: nodeID, ollama: ollama, throttle: throttle,
		metrics: metrics, learning: learning,
		queue: make(chan Task, queueSize), httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (tw *TaskWorker) Submit(task Task) bool {
	select {
	case tw.queue <- task:
		return true
	default:
		return false
	}
}

func (tw *TaskWorker) QueueDepth() int { return len(tw.queue) }

func (tw *TaskWorker) Run(ctx context.Context) {
	log.Printf("[worker] started, queue capacity=%d", cap(tw.queue))
	for {
		select {
		case <-ctx.Done():
			log.Println("[worker] shutting down")
			return
		case task := <-tw.queue:
			if !tw.throttle.Acquire() {
				log.Printf("[worker] task %s rejected -- contribution at 0%%", task.ID)
				tw.reportResult(ctx, task.Callback, TaskResult{
					TaskID: task.ID, NodeID: tw.nodeID, Status: "failed", Error: "contribution dial at 0%",
				})
				continue
			}
			tw.mu.Lock()
			tw.activeTasks++
			tw.mu.Unlock()

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

func (tw *TaskWorker) execute(ctx context.Context, task Task) {
	log.Printf("[worker] executing %s (type=%s model=%s)", task.ID, task.Type, task.Model)
	start := time.Now()

	result := TaskResult{TaskID: task.ID, NodeID: tw.nodeID, Model: task.Model}

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
	case "browser":
		result = tw.executeBrowser(ctx, task, result)
	default:
		result.Status = "failed"
		result.Error = fmt.Sprintf("unknown task type: %s", task.Type)
	}

	result.Duration = time.Since(start)
	if result.Status == "completed" {
		tw.completed.Add(1)
	}

	if tw.learning != nil {
		tw.learning.RecordTaskResult(task.Type, result.Model, task.Persona, result.Status == "completed", result.TokPerSec)
	}

	_, _, avgTokUpdated := tw.ollama.Stats()
	tw.mu.Lock()
	activeUpdated := tw.activeTasks
	tw.mu.Unlock()
	tw.metrics.UpdateTaskStats(tw.completed.Load(), activeUpdated, avgTokUpdated, "")

	log.Printf("[worker] task %s %s in %v (tokens=%d tok/s=%.1f)", task.ID, result.Status, result.Duration, result.Tokens, result.TokPerSec)

	if task.Callback != "" {
		tw.reportResult(ctx, task.Callback, result)
	}
}

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

	if prompt := ResolvePersonaPrompt(task.Persona); prompt != "" {
		chatReq.Messages = append([]OllamaChatMessage{{Role: "system", Content: prompt}}, chatReq.Messages...)
	}

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

	if prompt := ResolvePersonaPrompt(task.Persona); prompt != "" {
		genReq.Prompt = prompt + "\n\n" + genReq.Prompt
	}

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

func (tw *TaskWorker) executeBrowser(ctx context.Context, task Task, result TaskResult) TaskResult {
	var payload BrowserPayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("invalid browser payload: %v", err)
		return result
	}
	if payload.Goal == "" {
		result.Status = "failed"
		result.Error = "browser task requires 'goal' in payload"
		return result
	}

	taskJSON, err := json.Marshal(payload)
	if err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("marshal browser payload: %v", err)
		return result
	}

	timeout := 300 * time.Second
	if payload.Timeout > 0 {
		timeout = time.Duration(payload.Timeout) * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "python3", resolveWorkerScript())
	cmd.Stdin = bytes.NewReader(taskJSON)

	log.Printf("[worker] browser %s: spawning python (goal=%q)", task.ID, truncate(payload.Goal, 60))

	out, err := cmd.Output()
	if err != nil {
		var stderr string
		if exitErr, ok := err.(*exec.ExitError); ok {
			stderr = string(exitErr.Stderr)
		}
		result.Status = "failed"
		result.Error = fmt.Sprintf("python worker: %v\n%s", err, stderr)
		return result
	}

	var workerResult struct {
		Status    string  `json:"status"`
		Result    *string `json:"result"`
		StepsUsed int     `json:"steps_used"`
		Error     *string `json:"error"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(out), &workerResult); err != nil {
		result.Status = "failed"
		result.Error = fmt.Sprintf("parse worker output: %v\nraw: %s", err, string(out))
		return result
	}

	result.Status = workerResult.Status
	if workerResult.Result != nil {
		result.Output = *workerResult.Result
	}
	if workerResult.Error != nil && *workerResult.Error != "" {
		result.Error = *workerResult.Error
	}

	log.Printf("[worker] browser %s: %s (%d steps)", task.ID, result.Status, workerResult.StepsUsed)
	return result
}

func resolveWorkerScript() string {
	if env := os.Getenv("BORGCLAW_BROWSER_WORKER"); env != "" {
		return env
	}
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "..", "scripts", "browser-worker", "worker.py")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "scripts/browser-worker/worker.py"
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func (tw *TaskWorker) reportResult(ctx context.Context, callbackURL string, result TaskResult) {
	body, err := json.Marshal(result)
	if err != nil {
		log.Printf("[worker] marshal result %s: %v", result.TaskID, err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, "POST", callbackURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("[worker] callback request %s: %v", result.TaskID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := tw.httpClient.Do(req)
	if err != nil {
		log.Printf("[worker] callback %s: %v", result.TaskID, err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 204 {
		log.Printf("[worker] callback %s returned %d", result.TaskID, resp.StatusCode)
	}
}
