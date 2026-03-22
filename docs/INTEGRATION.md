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

## NAS Shared Knowledge Store

If you have a NAS on your LAN (Synology, TrueNAS, a Raspberry Pi with an external drive — anything), you can make its knowledge packs available to every drone in the hive simultaneously. No per-machine copies, no sync scripts. One mount point. All machines read the same files.

### How it works

The NAS is just a directory. BorgClaw does not care whether it is a local drive, an NFS mount, or an SMB share. If the path is readable, it is used. If it is not mounted, nothing breaks — the drone falls back to its local knowledge directory silently.

### Setup

**1. Mount the NAS on every machine in the hive.**

NFS (Linux):

```bash
sudo mount -t nfs 192.168.1.10:/volume1/borgclaw /mnt/borgclaw-nas
```

SMB/CIFS (Linux):

```bash
sudo mount -t cifs //192.168.1.10/borgclaw /mnt/borgclaw-nas -o username=...,password=...
```

macOS (SMB via Finder or):

```bash
open smb://192.168.1.10/borgclaw
# or: mount_smbfs //user@192.168.1.10/borgclaw /mnt/borgclaw-nas
```

For persistence across reboots, add the mount to `/etc/fstab` (Linux) or use `auto_master` / Login Items (macOS).

**2. Set `NAS_MOUNT_PATH` in your `.env`:**

```bash
NAS_MOUNT_PATH=/mnt/borgclaw-nas
```

**3. Place `.zim` knowledge packs on the NAS:**

```
/mnt/borgclaw-nas/
  wikipedia-mini.zim
  wiktionary.zim
  your-custom-pack.zim
```

**4. Restart Queen and any drones.** They will pick up the NAS path on startup, add it to the sandbox allowed roots, and include NAS-sourced ZIM domains in their heartbeat.

### Verifying the connection

Queen exposes two endpoints for checking NAS state:

```
GET /api/nas/status
```

Returns:

```json
{
  "configured": true,
  "accessible": true,
  "path": "/mnt/borgclaw-nas",
  "message": "mounted"
}
```

If the mount drops, `accessible` becomes `false` and `message` explains why (`not mounted`, `inaccessible: EIO`, etc.). The Queen dashboard security panel shows NAS mount status live — it checks `/api/nas/status` on page load.

```
GET /api/nas/browse?path=subdir
```

Lists files within the NAS directory. The `path` parameter is relative to `NAS_MOUNT_PATH` and is sandbox-checked (no path traversal outside the NAS root).

### Graceful degradation

The NAS being unavailable — mount dropped, NAS rebooting, network interruption — never crashes Queen or any drone. Drones report only their local ZIM domains in heartbeats. Queen routes knowledge queries to drones that have the required domain regardless of whether it came from the NAS or a local copy.

---

## What You Do Not Need to Change

The middleware stack (NATS, ntfy, LiteLLM), the Queen service, the bootstrap script, and the node registry — none of these care about your knowledge base. They are infrastructure. The only layer that touches your files is the agent layer, and that layer is fully configurable through `instructions.md` files and workflow YAMLs.

Start with `KNOWLEDGE_BASE_PATH`, point a workflow at one file you already have, and verify the output looks right before wiring up the rest.
