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

type OllamaClient struct {
	baseURL    string
	httpClient *http.Client

	mu           sync.Mutex
	totalTokens  int64
	totalTime    time.Duration
	requestCount int64
}

type OllamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []OllamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Options  map[string]any      `json:"options,omitempty"`
}

type OllamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OllamaChatResponse struct {
	Model     string            `json:"model"`
	Message   OllamaChatMessage `json:"message"`
	Done      bool              `json:"done"`
	TotalDur  int64             `json:"total_duration"`
	LoadDur   int64             `json:"load_duration"`
	EvalCount int               `json:"eval_count"`
	EvalDur   int64             `json:"eval_duration"`
}

type OllamaGenerateRequest struct {
	Model   string         `json:"model"`
	Prompt  string         `json:"prompt"`
	Stream  bool           `json:"stream"`
	Options map[string]any `json:"options,omitempty"`
}

type OllamaGenerateResponse struct {
	Model     string `json:"model"`
	Response  string `json:"response"`
	Done      bool   `json:"done"`
	TotalDur  int64  `json:"total_duration"`
	EvalCount int    `json:"eval_count"`
	EvalDur   int64  `json:"eval_duration"`
}

type OllamaModelInfo struct {
	Name       string    `json:"name"`
	ModifiedAt time.Time `json:"modified_at"`
	Size       int64     `json:"size"`
}

type OllamaTagsResponse struct {
	Models []OllamaModelInfo `json:"models"`
}

func NewOllamaClient(baseURL string) *OllamaClient {
	return &OllamaClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 5 * time.Minute},
	}
}

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
		return nil, fmt.Errorf("parse model list: %w", err)
	}
	return tags.Models, nil
}

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
		return nil, fmt.Errorf("chat request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, b)
	}

	var chatResp OllamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, fmt.Errorf("parse chat response: %w", err)
	}

	oc.mu.Lock()
	oc.requestCount++
	oc.totalTokens += int64(chatResp.EvalCount)
	oc.totalTime += time.Since(start)
	oc.mu.Unlock()

	return &chatResp, nil
}

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
		return nil, fmt.Errorf("generate request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, b)
	}

	var genResp OllamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&genResp); err != nil {
		return nil, fmt.Errorf("parse generate response: %w", err)
	}

	oc.mu.Lock()
	oc.requestCount++
	oc.totalTokens += int64(genResp.EvalCount)
	oc.totalTime += time.Since(start)
	oc.mu.Unlock()

	return &genResp, nil
}

type OllamaPullRequest struct {
	Model  string `json:"model"`
	Stream bool   `json:"stream"`
}

type OllamaPullResponse struct {
	Status string `json:"status"`
}

func (oc *OllamaClient) Pull(ctx context.Context, model string) error {
	pullClient := &http.Client{Timeout: 60 * time.Minute}
	body, err := json.Marshal(OllamaPullRequest{Model: model, Stream: false})
	if err != nil {
		return fmt.Errorf("marshal pull: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", oc.baseURL+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := pullClient.Do(req)
	if err != nil {
		return fmt.Errorf("pull %s: %w", model, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pull %s: %d: %s", model, resp.StatusCode, b)
	}

	var pullResp OllamaPullResponse
	if err := json.NewDecoder(resp.Body).Decode(&pullResp); err != nil {
		return fmt.Errorf("pull %s parse: %w", model, err)
	}
	if pullResp.Status != "success" {
		return fmt.Errorf("pull %s: status %q", model, pullResp.Status)
	}
	return nil
}

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
