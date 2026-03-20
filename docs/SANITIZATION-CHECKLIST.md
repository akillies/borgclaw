# BorgClaw — Pre-GitHub Sanitization Checklist

> **Purpose:** BorgClaw is open source (MIT). AK-OS is private. This checklist defines exactly what to strip, replace, or generalize before pushing to GitHub. Run through every item before `gh repo create borgclaw --public --source=. --push`.

---

## THE RULE

BorgClaw is the infrastructure layer — compute, orchestration, routing, agents. It has no opinion about whose identity sits above it. Everything that makes it *Alexander's* BorgClaw rather than *anyone's* BorgClaw lives in AK-OS, not in this repo.

**Ship:** Architecture, Queen service, agent structure, config schemas, bootstrap scripts, middleware stack, model routing logic, docs.

**Strip:** Any reference to Alexander Kline, AK-OS, specific projects (Ansible, Arcana, Pocket Tech), financial state, personal context, voice rules, entity data.

---

## CHECKLIST

### 1. Agent `instructions.md` files — REVIEW EACH ONE

Each agent folder has an `instructions.md` system prompt. These likely contain AK-OS-specific context.

- [ ] `agents/jarvis-router/instructions.md` — Strip any reference to AK-OS entity files, Alexander's priority queue, specific project names. Replace with generic placeholder: *"[YOUR-PERSONAL-AI-OS context files go here — see INTEGRATION.md]"*
- [ ] `agents/cerebro-analyst/instructions.md` — Strip interest domains (these come from AK-OS INTEREST-ONTOLOGY.md). Replace with: *"[YOUR interest taxonomy goes here — see INTEGRATION.md]"*
- [ ] `agents/comms-drafter/instructions.md` — Strip voice rules (these come from AK-OS voice-and-brand-rules.md). Replace with: *"[YOUR voice and brand rules go here — see INTEGRATION.md]"*
- [ ] `agents/ops-handler/instructions.md` — Strip any specific project references, file paths pointing to akos/
- [ ] `agents/sentinel/instructions.md` — Strip any personal monitoring targets, specific email accounts

### 2. Agent `mcps.json` files — REVIEW EACH ONE

MCP connections may reference personal accounts.

- [ ] Remove any hardcoded email addresses (alexanderkline13@gmail.com, admin@arcanaconcept.com)
- [ ] Remove any personal calendar IDs
- [ ] Replace with `YOUR_EMAIL_HERE`, `YOUR_CALENDAR_ID_HERE` placeholders
- [ ] Check for Drive folder IDs — strip and replace with placeholders

### 3. `config/models.json` — REVIEW

- [ ] Confirm no personal API keys are hardcoded (should be env vars)
- [ ] Confirm model routing rules reference only hardware profiles, not personal task types
- [ ] Strip any AK-OS-specific priority queue references (P0=Revenue etc — these are fine as examples but flag as configurable)

### 4. `config/agents/` YAML files — REVIEW EACH ONE

- [ ] Strip any agent budget values tied to Alexander's financial situation
- [ ] Strip any specific project names in task routing rules
- [ ] Ensure all personal context pointers say `YOUR_CONTEXT_DIR` not `~/akos/`

### 5. `config/scheduled/` — REVIEW

- [ ] Strip AK-OS-specific scheduled task content (morning-briefing prompt references AK-OS entities)
- [ ] Replace with generic examples showing the pattern
- [ ] Ensure no personal Gmail queries (`from:guidepoint`, `from:julie WFS`) are in example configs

### 6. `.env` and `.env.example` — CRITICAL

- [ ] Confirm `.env` is in `.gitignore` — **NEVER commit this file**
- [ ] Create `.env.example` with all required keys as placeholders:
  ```
  ANTHROPIC_API_KEY=your_key_here
  OPENAI_API_KEY=your_key_here
  ELEVENLABS_API_KEY=your_key_here
  NATS_URL=nats://localhost:4222
  QUEEN_PORT=3000
  QUEEN_SECRET=change_this_secret
  ```
- [ ] Scan entire repo for any hardcoded API keys: `grep -r "sk-" . --include="*.js" --include="*.ts" --include="*.json" --include="*.yaml"`

### 7. `scripts/bootstrap.sh` and `bootstrap.ps1` — REVIEW

- [ ] Strip any hardcoded paths pointing to `~/akos/` or Alexander's machine layout
- [ ] Ensure USB_DRIVE detection is generic
- [ ] Remove any personal hostname references

### 8. `.internal/` directory — **DO NOT SHIP**

- [ ] Confirm `.internal/` is in `.gitignore`
- [ ] This directory contains: MASTER-HANDOFF.md (AK-OS private context), BUILD-HANDOFF.md, CLAUDE-CODE-HANDOFF.md, SPAWN-REPO.md
- [ ] None of these should be public — they contain AK-OS architecture details, financial context, personal strategy

### 9. `research/` directory — REVIEW

- [ ] TECHNOLOGY-AUDIT.md — likely clean, confirm no personal context
- [ ] MIDDLEWARE-TECHNOLOGY-AUDIT.md — likely clean, confirm no personal context

### 10. `assets/` — REVIEW

- [ ] borgclaw-full-stack.html — check for any personal data in the visualization
- [ ] borgclaw-concept.html — check for personal context references

### 11. README.md — REVIEW

- [ ] The "identity agnosticism" philosophy section references AK-OS by name as an example — this is fine and intentional
- [ ] Confirm no personal contact info, no financial references
- [ ] Add a section: `## Integrating with your Personal AI OS` pointing to INTEGRATION.md (see below)

---

## CREATE BEFORE PUSH

### `docs/INTEGRATION.md` — needs to be written

This is the key doc for adoption. It explains:
1. What context files BorgClaw expects from your personal AI OS
2. Where to put them (the interface contract)
3. How to adapt `instructions.md` files for your own identity layer
4. Example: "If you're using Miessler's PAI, here's how to wire it in"
5. Example: "If you're building your own, here's the minimum viable context set"

### `docs/QUICKSTART.md` — confirm exists and is generic

Already referenced in directory structure — confirm it doesn't contain personal context.

---

## FINAL SCAN BEFORE PUSH

```bash
# Scan for personal identifiers
grep -r "alexander" . --include="*.md" --include="*.js" --include="*.json" --include="*.yaml" -i
grep -r "kline" . --include="*.md" --include="*.js" --include="*.json" --include="*.yaml" -i
grep -r "ak-os" . --include="*.md" --include="*.js" --include="*.json" --include="*.yaml" -i
grep -r "akos" . --include="*.md" --include="*.js" --include="*.json" --include="*.yaml" -i
grep -r "Christine\|Evander\|Arcana\|Ansible\|Pocket Tech\|Boundary Layer" . -i

# Scan for keys
grep -r "sk-ant\|sk-\|AIza\|Bearer " . --include="*.js" --include="*.ts" --include="*.json" --include="*.env"

# Confirm .gitignore covers the essentials
cat .gitignore | grep -E "\.env|\.internal|node_modules"
```

Review every hit. References in README/docs that are clearly illustrative examples (like mentioning AK-OS as one possible personal AI OS) are fine. References in config, agent instructions, or scripts are not.

---

## AFTER PUSH

- [ ] Confirm repo is public and README renders correctly
- [ ] Update `db/ak-os/entities/decisions.md` — BorgClaw GitHub push is an open decision
- [ ] Update `db/ak-os/projects/borgclaw/.internal/MASTER-HANDOFF.md` — note push date
- [ ] Update `db/ak-os/STATE.md` — BorgClaw deployed
- [ ] Consider posting to HN / relevant communities — this is a legitimate open source release
