package main

import "sync"

// Throttle enforces the contribution dial (0-100%) by controlling concurrent
// task slots and Ollama context size.
type Throttle struct {
	mu           sync.RWMutex
	contribution int
	maxSlots     int
	semaphore    chan struct{}
}

func NewThrottle(contribution int, cpuCores int) *Throttle {
	t := &Throttle{contribution: clamp(contribution, 0, 100)}
	t.maxSlots = t.calculateSlots(cpuCores)
	t.semaphore = make(chan struct{}, t.maxSlots)
	return t
}

func (t *Throttle) calculateSlots(cpuCores int) int {
	if t.contribution == 0 {
		return 0
	}
	baseSlots := cpuCores / 4
	if baseSlots < 1 {
		baseSlots = 1
	}
	slots := (baseSlots * t.contribution) / 100
	if slots < 1 {
		slots = 1
	}
	return slots
}

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

func (t *Throttle) Release() { <-t.semaphore }

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

func (t *Throttle) SetContribution(level int) {
	t.mu.Lock()
	t.contribution = clamp(level, 0, 100)
	t.mu.Unlock()
}

func (t *Throttle) Level() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.contribution
}

func (t *Throttle) Available() int { return cap(t.semaphore) - len(t.semaphore) }

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
