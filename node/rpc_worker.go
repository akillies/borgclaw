package main

// rpc_worker.go — llama.cpp rpc-server subprocess management
//
// When the drone is started with --mode rpc-worker it skips Ollama entirely
// and instead spawns the llama.cpp rpc-server binary, offering its raw
// compute to the hive for distributed model sharding.
//
// Discovery order for the rpc-server binary:
//   1. --rpc-server flag (explicit path)
//   2. PATH (standard tool install)
//   3. Same directory as the drone binary (bundled install)

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

// RPCWorker manages the llama.cpp rpc-server subprocess.
type RPCWorker struct {
	binaryPath string // resolved path to rpc-server executable
	port       int    // port to listen on (default 50052)

	cmd *exec.Cmd // running subprocess; nil before Start()
}

// NewRPCWorker creates an RPCWorker. binaryHint is optional — pass "" to
// rely solely on PATH and sibling-binary discovery.
func NewRPCWorker(binaryHint string, port int) (*RPCWorker, error) {
	resolved, err := resolveRPCServerBinary(binaryHint)
	if err != nil {
		return nil, err
	}
	if port <= 0 {
		port = 50052
	}
	return &RPCWorker{
		binaryPath: resolved,
		port:       port,
	}, nil
}

// Start launches rpc-server as a subprocess. Blocks until the context is
// cancelled, then sends SIGTERM and waits for the process to exit.
// Returns the exit error (nil if the context caused the stop).
func (w *RPCWorker) Start(ctx context.Context) error {
	args := []string{
		"--host", "0.0.0.0",
		"--port", strconv.Itoa(w.port),
	}

	w.cmd = exec.CommandContext(ctx, w.binaryPath, args...)
	w.cmd.Stdout = os.Stdout
	w.cmd.Stderr = os.Stderr

	log.Printf("[rpc-worker] starting %s on port %d", w.binaryPath, w.port)

	if err := w.cmd.Start(); err != nil {
		return fmt.Errorf("rpc-worker: failed to start %s: %w", w.binaryPath, err)
	}

	log.Printf("[rpc-worker] rpc-server pid=%d listening on :%d", w.cmd.Process.Pid, w.port)

	// Wait for the subprocess to exit. exec.CommandContext will send SIGKILL
	// when ctx is cancelled; we just surface the error to the caller.
	err := w.cmd.Wait()
	if ctx.Err() != nil {
		// Context cancellation is the expected shutdown path — not an error.
		log.Printf("[rpc-worker] rpc-server stopped (context cancelled)")
		return nil
	}
	return err
}

// Port returns the port the rpc-server will listen on.
func (w *RPCWorker) Port() int { return w.port }

// BinaryPath returns the resolved path to the rpc-server binary.
func (w *RPCWorker) BinaryPath() string { return w.binaryPath }

// resolveRPCServerBinary finds the rpc-server binary using a three-step
// priority order: explicit hint > PATH > sibling of the drone binary.
func resolveRPCServerBinary(hint string) (string, error) {
	// 1. Explicit flag — trust the operator.
	if hint != "" {
		if _, err := os.Stat(hint); err == nil {
			abs, _ := filepath.Abs(hint)
			return abs, nil
		}
		return "", fmt.Errorf("rpc-server binary not found at provided path: %s", hint)
	}

	// 2. PATH lookup.
	if p, err := exec.LookPath("rpc-server"); err == nil {
		return p, nil
	}

	// 3. Same directory as the drone binary (bundled install).
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "rpc-server")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf(
		"rpc-server binary not found: install llama.cpp and ensure rpc-server is on PATH, " +
			"or place it alongside the drone binary, or use --rpc-server /path/to/rpc-server",
	)
}
