package main

import (
	"sync"
)

// Throttle enforces the contribution dial (0-100%) by controlling concurrent
// task slots and Ollama context size. At 0%, the node refuses all tasks.
// At 100%, it uses all available resources.
type Throttle struct {
	mu           sync.RWMutex
	contribution int // 0-100

	maxSlots int // derived from contribution + hardware
	semaphore chan struct{}
}

// NewThrottle creates a throttle with the given contribution level and hardware capacity.
func NewThrottle(contribution int, cpuCores int) *Throttle {
	t := &Throttle{
		contribution: clamp(contribution, 0, 100),
	}
	t.maxSlots = t.calculateSlots(cpuCores)
	t.semaphore = make(chan struct{}, t.maxSlots)
	return t
}

// calculateSlots maps contribution percentage to concurrent task slots.
// Minimum 1 slot at any contribution > 0, scales with cores.
func (t *Throttle) calculateSlots(cpuCores int) int {
	if t.contribution == 0 {
		return 0
	}

	// Base: 1 slot per 4 cores, minimum 1
	baseSlots := cpuCores / 4
	if baseSlots < 1 {
		baseSlots = 1
	}

	// Scale by contribution
	slots := (baseSlots * t.contribution) / 100
	if slots < 1 {
		slots = 1
	}

	return slots
}

// Acquire blocks until a task slot is available. Returns false if contribution is 0.
func (t *Throttle) Acquire() bool {
	t.mu.RLock()
	if t.contribution == 0 {
		t.mu.RUnlock()
		return false
	}
	t.mu.RUnlock()

	t.semaphore <- struct{}{}
	return true
}

// TryAcquire attempts to get a task slot without blocking.
func (t *Throttle) TryAcquire() bool {
	t.mu.RLock()
	if t.contribution == 0 {
		t.mu.RUnlock()
		return false
	}
	t.mu.RUnlock()

	select {
	case t.semaphore <- struct{}{}:
		return true
	default:
		return false
	}
}

// Release frees a task slot.
func (t *Throttle) Release() {
	<-t.semaphore
}

// OllamaNumCtx returns the num_ctx value to use for Ollama requests,
// scaled by contribution. Full context at 100%, minimum 2048 at any level.
func (t *Throttle) OllamaNumCtx(baseCtx int) int {
	t.mu.RLock()
	c := t.contribution
	t.mu.RUnlock()

	if baseCtx <= 0 {
		baseCtx = 4096
	}

	ctx := (baseCtx * c) / 100
	if ctx < 2048 {
		ctx = 2048
	}
	return ctx
}

// SetContribution updates the dial. Does NOT resize the semaphore live —
// new value takes effect on next Acquire call via the contribution gate.
func (t *Throttle) SetContribution(level int) {
	t.mu.Lock()
	t.contribution = clamp(level, 0, 100)
	t.mu.Unlock()
}

// Level returns the current contribution percentage.
func (t *Throttle) Level() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.contribution
}

// Available returns the number of free task slots.
func (t *Throttle) Available() int {
	return cap(t.semaphore) - len(t.semaphore)
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
