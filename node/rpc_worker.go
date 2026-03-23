package main

// rpc_worker.go -- llama.cpp rpc-server subprocess management.
// When started with --mode rpc-worker, the drone skips Ollama and spawns
// llama.cpp rpc-server, offering raw compute for distributed model sharding.

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

type RPCWorker struct {
	binaryPath string
	port       int
	cmd        *exec.Cmd
}

func NewRPCWorker(binaryHint string, port int) (*RPCWorker, error) {
	resolved, err := resolveRPCServerBinary(binaryHint)
	if err != nil {
		return nil, err
	}
	if port <= 0 {
		port = 50052
	}
	return &RPCWorker{binaryPath: resolved, port: port}, nil
}

func (w *RPCWorker) Start(ctx context.Context) error {
	w.cmd = exec.CommandContext(ctx, w.binaryPath, "--host", "0.0.0.0", "--port", strconv.Itoa(w.port))
	w.cmd.Stdout = os.Stdout
	w.cmd.Stderr = os.Stderr

	log.Printf("[rpc-worker] starting %s on port %d", w.binaryPath, w.port)
	if err := w.cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", w.binaryPath, err)
	}
	log.Printf("[rpc-worker] pid=%d listening on :%d", w.cmd.Process.Pid, w.port)

	err := w.cmd.Wait()
	if ctx.Err() != nil {
		log.Printf("[rpc-worker] stopped (context cancelled)")
		return nil
	}
	return err
}

func (w *RPCWorker) Port() int          { return w.port }
func (w *RPCWorker) BinaryPath() string { return w.binaryPath }

func resolveRPCServerBinary(hint string) (string, error) {
	if hint != "" {
		if _, err := os.Stat(hint); err == nil {
			abs, _ := filepath.Abs(hint)
			return abs, nil
		}
		return "", fmt.Errorf("rpc-server not found at: %s", hint)
	}
	if p, err := exec.LookPath("rpc-server"); err == nil {
		return p, nil
	}
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "rpc-server")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("rpc-server not found: install llama.cpp or use --rpc-server /path/to/rpc-server")
}
