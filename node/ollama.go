package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// OllamaClient wraps the Ollama REST API with metrics tracking.
type OllamaClient struct {
	baseURL    string
	httpClient *http.Client

	mu           sync.Mutex
	totalTokens  int64
	totalTime    time.Duration
	requestCount int64
}

// OllamaChatRequest mirrors Ollama's /api/chat request format.
type OllamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []OllamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Options  map[string]any      `json:"options,omitempty"`
}

// OllamaChatMessage is a single message in a chat.
type OllamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// OllamaChatResponse mirrors Ollama's /api/chat response (non-streaming).
type OllamaChatResponse struct {
	Model     string            `json:"model"`
	Message   OllamaChatMessage `json:"message"`
	Done      bool              `json:"done"`
	TotalDur  int64             `json:"total_duration"`  // nanoseconds
	LoadDur   int64             `json:"load_duration"`   // nanoseconds
	EvalCount int               `json:"eval_count"`      // tokens generated
	EvalDur   int64             `json:"eval_duration"`   // nanoseconds
}

// OllamaGenerateRequest mirrors Ollama's /api/generate request.
type OllamaGenerateRequest struct {
	Model   string         `json:"model"`
	Prompt  string         `json:"prompt"`
	Stream  bool           `json:"stream"`
	Options map[string]any `json:"options,omitempty"`
}

// OllamaGenerateResponse mirrors Ollama's /api/generate response.
type OllamaGenerateResponse struct {
	Model     string `json:"model"`
	Response  string `json:"response"`
	Done      bool   `json:"done"`
	TotalDur  int64  `json:"total_duration"`
	EvalCount int    `json:"eval_count"`
	EvalDur   int64  `json:"eval_duration"`
}

// OllamaModelInfo from /api/tags.
type OllamaModelInfo struct {
	Name       string    `json:"name"`
	ModifiedAt time.Time `json:"modified_at"`
	Size       int64     `json:"size"`
}

// OllamaTagsResponse from /api/tags.
type OllamaTagsResponse struct {
	Models []OllamaModelInfo `json:"models"`
}

// NewOllamaClient creates a client pointed at the given Ollama server.
func NewOllamaClient(baseURL string) *OllamaClient {
	return &OllamaClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 5 * time.Minute, // LLM inference can be slow
		},
	}
}

// Healthy checks if Ollama is reachable.
func (oc *OllamaClient) Healthy(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, "GET", oc.baseURL+"/api/tags", nil)
	if err != nil {
		return false
	}
	resp, err := oc.httpClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

// ListModels returns locally available models.
func (oc *OllamaClient) ListModels(ctx context.Context) ([]OllamaModelInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", oc.baseURL+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	resp, err := oc.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama unreachable: %w", err)
	}
	defer resp.Body.Close()

	var tags OllamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&tags); err != nil {
		return nil, fmt.Errorf("parsing model list: %w", err)
	}
	return tags.Models, nil
}

// Chat sends a chat completion request (non-streaming) and tracks metrics.
func (oc *OllamaClient) Chat(ctx context.Context, req OllamaChatRequest) (*OllamaChatResponse, error) {
	req.Stream = false

	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", oc.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := oc.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama chat request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp OllamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, fmt.Errorf("parsing chat response: %w", err)
	}
	elapsed := time.Since(start)

	// Track metrics
	oc.mu.Lock()
	oc.requestCount++
	oc.totalTokens += int64(chatResp.EvalCount)
	oc.totalTime += elapsed
	oc.mu.Unlock()

	return &chatResp, nil
}

// Generate sends a completion request (non-streaming) and tracks metrics.
func (oc *OllamaClient) Generate(ctx context.Context, req OllamaGenerateRequest) (*OllamaGenerateResponse, error) {
	req.Stream = false

	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", oc.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := oc.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ollama generate request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(respBody))
	}

	var genResp OllamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&genResp); err != nil {
		return nil, fmt.Errorf("parsing generate response: %w", err)
	}
	elapsed := time.Since(start)

	oc.mu.Lock()
	oc.requestCount++
	oc.totalTokens += int64(genResp.EvalCount)
	oc.totalTime += elapsed
	oc.mu.Unlock()

	return &genResp, nil
}

// Stats returns aggregate inference stats.
func (oc *OllamaClient) Stats() (requests int64, tokens int64, avgTokPerSec float64) {
	oc.mu.Lock()
	defer oc.mu.Unlock()

	requests = oc.requestCount
	tokens = oc.totalTokens

	if oc.totalTime > 0 {
		avgTokPerSec = float64(oc.totalTokens) / oc.totalTime.Seconds()
	}
	return
}
