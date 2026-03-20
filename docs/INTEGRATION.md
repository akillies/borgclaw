# Integrating BorgClaw with Your Knowledge System

BorgClaw is infrastructure for running a personal AI cluster. It ships with five agents, a workflow engine, and a middleware stack. What it does not ship with is your knowledge — your context files, your entity registries, your workflows tailored to your life.

This doc explains how to wire BorgClaw to whatever personal knowledge system you already have.

---

## Overview

BorgClaw does not care what your knowledge system looks like. It does not require a specific format, folder structure, or tool. It only needs to know where your files are, and then agents read whatever you point them at.

The connection point is a single environment variable: `KNOWLEDGE_BASE_PATH`. Set it, customize a few YAML configs, and your agents operate against your actual context instead of placeholder examples.

---

## The Knowledge Base Path

```bash
# In your .env
KNOWLEDGE_BASE_PATH=/path/to/your/knowledge
```

This path can be anywhere on disk — a directory you already maintain, a second-brain vault, an exported wiki, a folder of markdown files. The only requirement is that it is readable by the machine running BorgClaw.

If you are running BorgClaw on the same machine as your knowledge base, use an absolute path. If you are running it on a remote node (a home server, a Mac Mini), mount the directory over the network or replicate it with rsync/git.

Leave `KNOWLEDGE_BASE_PATH=./knowledge` to use the `knowledge/` directory inside the BorgClaw repo itself. This is the default for getting started — create the folder and put your files there.

---

## Connecting Your Files

Workflow YAMLs in `config/workflows/` define what each scheduled task does. They reference knowledge base files directly. The default workflows ship with hardcoded example paths (like `interest-ontology.md` or `entity-registry.md`). Replace those with paths to your actual files.

Example — the signal scan workflow loads an interest ontology to score search results:

```yaml
# config/workflows/signal-scan.yaml
- id: classify
  agent: cerebro-analyst
  inputs:
    interest_ontology: "{{KNOWLEDGE_BASE_PATH}}/your-interest-domains.md"
    existing_landscape: "{{KNOWLEDGE_BASE_PATH}}/your-tool-tracker.md"
```

The `{{KNOWLEDGE_BASE_PATH}}` template variable is resolved at runtime from your `.env`. Use it anywhere in a workflow YAML to reference files in your knowledge base without hardcoding absolute paths.

You do not need to restructure your existing files to match BorgClaw's expected format. Just point the workflow at the right file and tell the agent (in its instructions) how to read it.

---

## Agent Instructions

Each agent has an `instructions.md` file in `agents/[agent-name]/`. This is the system prompt — it defines what the agent knows, how it behaves, and what context it carries at all times.

The default instructions are generic. Customize them for your system.

For example, `agents/cerebro-analyst/instructions.md` ships with placeholder notes about scoring signals. Replace those with the actual scoring criteria from your interest ontology. Or add a line like:

```markdown
## Your Context Files
- Interest domains: {{KNOWLEDGE_BASE_PATH}}/domains.md
- Active projects: {{KNOWLEDGE_BASE_PATH}}/projects.md
- Key relationships: {{KNOWLEDGE_BASE_PATH}}/people.md

Read these files before any research or analysis task.
```

The `[CUSTOMIZE]` markers in the default instructions show exactly where to make changes. Search for that string to find every customization point in the agent files.

---

## Scheduled Tasks

`config/scheduled/` contains cron-triggered workflows — things like a morning briefing, a weekly signal scan, a relationship decay check. Each one ships configured to deliver output as a draft (email, file, or notification) rather than taking immediate action. Nothing gets sent without your approval.

For each scheduled task, check the `deliver` step at the bottom of the YAML. It has a `to` field with a `{{YOUR_EMAIL}}` placeholder. Set it to your actual delivery address.

Then check the input steps. Most of them query feeds, inboxes, or sources. Point those queries at your actual sources:

```yaml
# Replace the example queries with your real ones
- id: scan_inbox
  inputs:
    queries:
      - "from:yourimportantcontact.com"
      - "from:your-revenue-platform.com"
      - "is:unread is:important"
```

The workflow engine reads these YAMLs at runtime, so changes take effect on the next trigger — no restart needed.

---

## Example Integration

Minimal setup: three files in a knowledge directory, one workflow that reads them, one agent instruction that references them.

**Directory structure:**

```
knowledge/
  domains.md       # Your areas of interest, used to score signals
  projects.md      # Active projects, used for context in briefings
  people.md        # Key contacts, used for relationship decay checks
```

**Workflow — morning briefing reads two of them:**

```yaml
# config/workflows/morning-briefing.yaml
- id: scan_signals
  agent: cerebro-analyst
  inputs:
    interest_domains: "{{KNOWLEDGE_BASE_PATH}}/domains.md"
    depth: quick

- id: pattern_scan
  agent: sentinel
  inputs:
    projects_file: "{{KNOWLEDGE_BASE_PATH}}/projects.md"
    people_file: "{{KNOWLEDGE_BASE_PATH}}/people.md"
```

**Agent instruction — cerebro knows where to look:**

```markdown
# agents/cerebro-analyst/instructions.md

## Context
Before any research task, read:
- {{KNOWLEDGE_BASE_PATH}}/domains.md — your scoring criteria for what matters
- {{KNOWLEDGE_BASE_PATH}}/projects.md — current work, for relevance scoring
```

That is the full integration. The agents read your files, the workflows route outputs back to you as drafts, and you approve or reject before anything acts.

---

## Advanced: Private Overlays

Some parts of your knowledge base should not be committed to a public repo. API keys, personal contact details, private strategy documents — these belong outside version control.

Create a `borgclaw-private/` directory outside the BorgClaw repo root. This directory is gitignored by default. Store sensitive configs and knowledge files there, and point `KNOWLEDGE_BASE_PATH` at it (or a parent directory that contains both your public and private knowledge).

```
~/
  borgclaw/             # This repo — public configs, agent templates
  borgclaw-private/     # Gitignored — personal context, credentials, overlays
    knowledge/
      people.md
      financial.md
      custom-workflows/
```

You can also use the `borgclaw-private/` directory to override default configs. Any file in `borgclaw-private/config/` takes precedence over the default `config/` at runtime. This lets you customize agent instructions and workflow YAMLs without touching the tracked files — useful if you want to pull upstream updates without clobbering your customizations.

---

## What You Do Not Need to Change

The middleware stack (NATS, ntfy, LiteLLM), the Queen service, the bootstrap script, and the node registry — none of these care about your knowledge base. They are infrastructure. The only layer that touches your files is the agent layer, and that layer is fully configurable through `instructions.md` files and workflow YAMLs.

Start with `KNOWLEDGE_BASE_PATH`, point a workflow at one file you already have, and verify the output looks right before wiring up the rest.
