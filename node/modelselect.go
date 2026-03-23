package main

// Tier-based model selection. On startup the drone compares installed models
// against the recommended set for its hardware tier and queues pulls for any
// missing ones. Tier mapping mirrors prepare-usb.sh profiles.

import (
	"context"
	"log"
	"strings"
	"time"
)

var TierModels = map[string][]string{
	"nano":   {"gemma3:1b"},
	"edge":   {"phi4-mini"},
	"worker": {"phi4-mini", "qwen3:8b"},
	"heavy":  {"phi4-mini", "qwen3:8b", "gemma3:27b"},
	"beast":  {"phi4-mini", "qwen3:8b", "gemma3:27b", "qwen2.5-coder:14b"},
}

func modelBaseName(name string) string {
	if strings.HasSuffix(name, ":latest") {
		return strings.TrimSuffix(name, ":latest")
	}
	return name
}

func installedSet(models []OllamaModelInfo) map[string]bool {
	set := make(map[string]bool, len(models))
	for _, m := range models {
		set[modelBaseName(m.Name)] = true
	}
	return set
}

// EnsureOptimalModels returns model names that need pulling for this tier.
// Does not pull -- caller owns the pull loop.
func EnsureOptimalModels(ollama *OllamaClient, hw HardwareProfile) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	recommended, ok := TierModels[hw.Tier]
	if !ok {
		log.Printf("[modelselect] unknown tier %q -- skipping", hw.Tier)
		return nil
	}
	log.Printf("[modelselect] tier=%s recommended=%v", hw.Tier, recommended)

	installed, err := ollama.ListModels(ctx)
	if err != nil {
		log.Printf("[modelselect] list models failed: %v -- skipping", err)
		return nil
	}
	names := installedSet(installed)

	ceiling := heavyModelForTier(hw.Tier)
	for _, m := range installed {
		if isModelTooHeavy(modelBaseName(m.Name), ceiling) {
			log.Printf("[modelselect] WARN %q may be too heavy for tier=%s (%dMB RAM)", m.Name, hw.Tier, hw.RAMTotal)
		}
	}

	var missing []string
	for _, model := range recommended {
		if names[model] {
			log.Printf("[modelselect] %s installed", model)
		} else {
			missing = append(missing, model)
		}
	}
	return missing
}

func heavyModelForTier(tier string) uint64 {
	switch tier {
	case "nano":
		return 2048
	case "edge":
		return 4096
	case "worker":
		return 8192
	case "heavy":
		return 20480
	default:
		return 0
	}
}

func isModelTooHeavy(modelName string, ceilingMB uint64) bool {
	if ceilingMB == 0 {
		return false
	}
	knownHeavy := map[string]uint64{
		"gemma3:27b": 18000, "qwen3:8b": 5500, "qwen2.5-coder:14b": 9500,
		"phi4-mini": 3500, "gemma3:1b": 1000,
	}
	required, known := knownHeavy[modelName]
	return known && required > ceilingMB
}
