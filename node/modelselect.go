package main

// modelselect.go — Smart model selection for drone first-boot.
//
// On startup (after Ollama connectivity check), the drone compares what's
// installed against the recommended models for its hardware tier. It queues
// pulls for any missing upgrades and warns if a loaded model is too heavy.
//
// Tier mapping mirrors the USB profile definitions in prepare-usb.sh:
//   nano   (<4GB RAM)   → gemma3:1b
//   edge   (4-8GB RAM)  → phi4-mini
//   worker (8-24GB RAM) → qwen3:8b, phi4-mini
//   heavy  (24-64GB)    → gemma3:27b, qwen3:8b, phi4-mini
//   beast  (64GB+)      → gemma3:27b, qwen3:8b, phi4-mini, qwen2.5-coder:14b

import (
	"context"
	"log"
	"strings"
	"time"
)

// TierModels maps each hardware tier to its recommended model stack.
// Models are ordered from lightest to heaviest — all should be pulled.
var TierModels = map[string][]string{
	"nano":   {"gemma3:1b"},
	"edge":   {"phi4-mini"},
	"worker": {"phi4-mini", "qwen3:8b"},
	"heavy":  {"phi4-mini", "qwen3:8b", "gemma3:27b"},
	"beast":  {"phi4-mini", "qwen3:8b", "gemma3:27b", "qwen2.5-coder:14b"},
}

// modelBaseName strips the tag from a model name for fuzzy matching.
// "phi4-mini:latest" → "phi4-mini", "qwen3:8b" → "qwen3:8b"
func modelBaseName(name string) string {
	// Ollama returns names like "phi4-mini:latest" — strip :latest suffix only.
	// Tags like ":8b", ":27b" are meaningful and must be kept.
	if strings.HasSuffix(name, ":latest") {
		return strings.TrimSuffix(name, ":latest")
	}
	return name
}

// installedSet builds a set of installed model base-names from ListModels output.
func installedSet(models []OllamaModelInfo) map[string]bool {
	set := make(map[string]bool, len(models))
	for _, m := range models {
		set[modelBaseName(m.Name)] = true
	}
	return set
}

// EnsureOptimalModels checks which recommended models for the hardware tier
// are not yet installed in Ollama. It returns the list of model names that
// need to be pulled. It does NOT pull them — the caller owns the pull loop
// so it can interleave heartbeats after each successful pull.
//
// Heavy-model warnings (models too large for the tier) are logged here as a
// side effect — they don't affect the return value.
func EnsureOptimalModels(ollama *OllamaClient, hw HardwareProfile) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	recommended, ok := TierModels[hw.Tier]
	if !ok {
		log.Printf("[modelselect] unknown tier %q — skipping model check", hw.Tier)
		return nil
	}

	log.Printf("[modelselect] tier=%s, recommended models: %v", hw.Tier, recommended)

	installed, err := ollama.ListModels(ctx)
	if err != nil {
		log.Printf("[modelselect] could not list models: %v — skipping model check", err)
		return nil
	}

	installedNames := installedSet(installed)

	// Warn about models that may be too heavy for this tier.
	heavyThreshold := heavyModelForTier(hw.Tier)
	for _, m := range installed {
		base := modelBaseName(m.Name)
		if isModelTooHeavy(base, heavyThreshold) {
			log.Printf("[modelselect] WARN model %q may be too heavy for tier=%s (%dMB RAM) — consider removing if inference is slow",
				m.Name, hw.Tier, hw.RAMTotal)
		}
	}

	// Collect missing models in recommended order.
	var missing []string
	for _, model := range recommended {
		if installedNames[model] {
			log.Printf("[modelselect] %s already installed", model)
		} else {
			missing = append(missing, model)
		}
	}
	return missing
}

// heavyModelForTier returns the approximate RAM ceiling (MB) for a tier.
// Any model that needs more than this is flagged as potentially too heavy.
func heavyModelForTier(tier string) uint64 {
	switch tier {
	case "nano":
		return 2048 // <2GB: only tiny models
	case "edge":
		return 4096 // <4GB: phi4-mini range
	case "worker":
		return 8192 // <8GB: 8B models
	case "heavy":
		return 20480 // <20GB: 27B models
	default:
		return 0 // beast: no ceiling
	}
}

// isModelTooHeavy returns true if a model's known minimum RAM requirement
// exceeds the tier ceiling. This is a best-effort heuristic based on known
// model sizes — it won't catch every case, but catches the obvious ones.
func isModelTooHeavy(modelName string, ceilingMB uint64) bool {
	if ceilingMB == 0 {
		return false // beast tier: nothing is too heavy
	}
	// Known minimum RAM requirements in MB at Q4_K_M quantization.
	knownHeavy := map[string]uint64{
		"gemma3:27b":       18000,
		"qwen3:8b":         5500,
		"qwen2.5-coder:14b": 9500,
		"phi4-mini":        3500,
		"gemma3:1b":        1000,
	}
	required, known := knownHeavy[modelName]
	if !known {
		return false // unknown model — don't warn
	}
	return required > ceilingMB
}
