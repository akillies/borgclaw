# Workflows

These are example workflow templates. Customize them or create your own.

Each `.yaml` file defines a DAG (directed acyclic graph) of steps that the Queen executes. Steps can depend on other steps, require approval, and route to specific agents.

## Quick Start

1. Copy an existing workflow
2. Change the `name`, `description`, and `steps`
3. Replace `{{YOUR_EMAIL}}` and `{{KNOWLEDGE_BASE_PATH}}` with your values
4. Queen auto-loads all `.yaml` files in this directory on startup

## Creating a New Workflow

```yaml
name: my-custom-workflow
version: "1.0"
description: What this workflow does

steps:
  - id: step_one
    agent: cerebro-analyst
    action: research
    description: "Research the topic"
    inputs:
      topic: "{{input.topic}}"
    outputs:
      - research_brief
    timeout: 10m
    requires_approval: false

  - id: step_two
    agent: comms-drafter
    action: write
    description: "Draft the output"
    depends_on: [step_one]
    inputs:
      brief: "{{step_one.research_brief}}"
    requires_approval: true
```

Drop the file here. Restart Queen or she'll pick it up on next boot.
