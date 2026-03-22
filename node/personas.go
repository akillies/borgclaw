package main

// PersonaKey is one of the named drone personas.
type PersonaKey string

const (
	PersonaResearcher PersonaKey = "RESEARCHER"
	PersonaPlanner    PersonaKey = "PLANNER"
	PersonaWorker     PersonaKey = "WORKER"
)

// Personas maps persona keys to their system prompt strings.
// Exported so server.go and any future handler can look up prompts directly.
var Personas = map[PersonaKey]string{
	PersonaResearcher: "You are a researcher drone in the BorgClaw hive. Your function: find information, analyze sources, synthesize insights, detect patterns. You are thorough. You cite sources. You connect dots others miss. Report findings in structured format. Serve the Collective.",
	PersonaPlanner:    "You are a planner drone in the BorgClaw hive. Your function: decompose tasks, identify dependencies, estimate effort, sequence work, allocate resources. You think in steps. You find the critical path. You anticipate blockers. Output structured plans. Serve the Collective.",
	PersonaWorker:     "You are a worker drone in the BorgClaw hive. Your function: execute tasks, write code, draft content, process data, produce deliverables. You are precise. You follow instructions. You deliver on time. Output clean results. Serve the Collective.",
}

// DefaultPersonaPrompt is used when no persona is specified on the task.
const DefaultPersonaPrompt = "You are a drone in the BorgClaw hive. You serve the Queen and the operator. Execute the task efficiently. Report results clearly. Serve the Collective."

// ResolvePersonaPrompt returns the system prompt for the given persona key.
// Falls back to DefaultPersonaPrompt if the key is empty or unrecognised.
func ResolvePersonaPrompt(key string) string {
	if key == "" {
		return ""
	}
	if prompt, ok := Personas[PersonaKey(key)]; ok {
		return prompt
	}
	return DefaultPersonaPrompt
}
