# Ghost Worker — Browser Agent Workstation Spec

## The Concept

A drone on old hardware (4GB RAM, no GPU) that can't do useful LLM inference but CAN control a browser and keyboard. The hive's hands. Queen tells it what to do, capable drones do the thinking, the ghost worker does the acting.

```
Queen (decides) → capable drone (thinks via LiteLLM) → ghost worker (acts via browser)
```

The old MacBook Air in the closet becomes an invisible worker that fills forms, extracts data, monitors dashboards, posts content, and handles any browser-based task — autonomously, 24/7, silently.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              GHOST WORKER DRONE                  │
│                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌────────┐│
│  │  Drone   │    │  browser-use │    │Lightpanda││
│  │  Binary  │───→│  (Python)    │───→│ (Zig)  ││
│  │  (Go)    │    │              │    │ 24MB/  ││
│  │          │    │  LLM calls   │    │ session││
│  │ heartbeat│    │  → LiteLLM   │    │        ││
│  │ metrics  │    │    :4000     │    │  CDP   ││
│  │ task rx  │    │  (remote)    │    │endpoint││
│  └──────────┘    └──────────────┘    └────────┘│
│                                                  │
│  RAM total: ~100MB (drone 20MB + Python 50MB     │
│             + Lightpanda 24MB)                   │
│  CPU: minimal (browser actions are bursty)       │
│  GPU: not needed                                 │
│  Network: needs LAN access to Queen + internet   │
└─────────────────────────────────────────────────┘
```

## Components

### 1. Lightpanda Browser (ships on USB drive)
- Source: github.com/lightpanda-io/browser (23K stars, AGPL-3.0)
- Single Zig binary, ~15MB
- 9x less RAM than Chrome, 11x faster, instant startup
- Exposes Chrome DevTools Protocol (CDP) endpoint
- No GUI rendering — headless only, built for AI agents
- 24MB per session vs Chrome's 207MB
- On a 4GB machine: can run dozens of concurrent sessions

### 2. browser-use (Python agent layer)
- Source: github.com/browser-use/browser-use
- Python lib that connects LLM reasoning to browser actions
- Takes any LangChain-compatible LLM client
- Point at `ChatOpenAI(base_url="http://queen-ip:4000", api_key="borgclaw")`
- ALL reasoning happens on capable drones via LiteLLM — ghost worker just executes
- Supports: navigation, clicking, typing, form filling, data extraction, scrolling, waiting

### 3. Drone Binary (Go, already built)
- Receives task from Queen with `persona: "operator"` and `type: "browser"`
- Spawns browser-use Python process with the task description
- Reports status back to Queen via heartbeat
- Contribution dial still works — set to 0 to stop accepting browser tasks

## Task Flow

### Queen dispatches a browser task:
```json
{
  "id": "task-042",
  "type": "browser",
  "persona": "operator",
  "model": "auto",
  "payload": {
    "goal": "Go to linkedin.com/jobs, search for 'AI Strategy Director Victoria BC', extract the first 10 results with title, company, and link",
    "max_steps": 20,
    "timeout": "5m",
    "screenshot_on_complete": true
  },
  "callback": "http://queen-ip:9090/api/tasks/result"
}
```

### Ghost worker executes:
1. Drone receives task via `POST /task`
2. Drone spawns browser-use with Lightpanda as target
3. browser-use calls LiteLLM :4000 for reasoning ("what should I click next?")
4. Lightpanda executes the browser actions
5. LLM reasoning loop: observe page → decide action → execute → observe → repeat
6. On completion: extract results, optionally take screenshot
7. POST results back to Queen's callback URL

### Queen processes results:
1. Results arrive at callback
2. If `requires_approval`: push to approval queue (Law Two)
3. If approved or auto-approved: log to activity feed
4. Available to other workflow steps that depend on this task

## What Ghost Workers Can Do

### Data extraction
- Scrape job listings, product prices, news articles
- Monitor competitor websites for changes
- Extract structured data from web forms and dashboards

### Form automation
- Fill and submit web forms (applications, registrations, surveys)
- Multi-step workflows (login → navigate → fill → submit → verify)
- Handle dynamic forms (dropdowns, date pickers, file uploads)

### Content management
- Post to social media (LinkedIn, Twitter — with Law Two approval)
- Update CMS pages
- Schedule and publish blog posts

### Monitoring
- Watch dashboards for anomalies (Grafana, analytics, etc.)
- Screenshot and report at intervals
- Alert on visual changes (page looks different from last check)

### Administrative tasks
- Pay bills through banking portals
- File forms with government websites
- Manage subscriptions and accounts

All subject to Law Two. The ghost worker drafts the action. The operator approves before anything external happens.

## USB Drive Addition

The USB drive gains:
```
BORGCLAW/
├── drone-linux        (10MB)
├── drone-mac-arm64    (10MB)
├── drone-mac-intel    (10MB)
├── drone-windows.exe  (10MB)
├── lightpanda         (15MB)  ← NEW
├── browser-worker/    (50MB)  ← NEW
│   ├── requirements.txt
│   └── worker.py      ← browser-use wrapper
├── ollama-install.sh  (16KB)
├── models/            (2.3GB)
├── config/drone.json
├── setup.sh
└── README.txt
```

Total: ~2.5GB — still fits 4GB drive.

### setup.sh gains hardware-aware role detection:
```bash
# Detect hardware capability
RAM_MB=$(free -m | awk '/Mem:/ {print $2}')
GPU=$(detect_gpu)

if [ "$RAM_MB" -ge 8192 ] && [ -n "$GPU" ]; then
  ROLE="compute"        # Full inference + browser
  install_ollama
  install_lightpanda
elif [ "$RAM_MB" -ge 4096 ]; then
  ROLE="workstation"    # Browser only, LLM reasoning remote
  install_lightpanda
  # Skip Ollama — not enough resources
else
  ROLE="satellite"      # Knowledge/search only
  # Skip both — just heartbeat + QMD
fi
```

## Implementation Order

1. **Add Lightpanda binary to USB staging** (~15MB download)
2. **Write `browser-worker/worker.py`** — thin wrapper around browser-use that:
   - Accepts task JSON on stdin or HTTP
   - Initializes Lightpanda via CDP
   - Connects LLM to LiteLLM endpoint
   - Executes browser-use agent loop
   - Returns results as JSON
3. **Add `type: "browser"` handling to drone's worker.go** — spawns Python process, pipes task, collects results
4. **Add `persona: "operator"` to drone personas** — system prompt for browser actions
5. **Update setup.sh** — role detection based on hardware, install appropriate components
6. **Update Queen dashboard** — show browser task results, screenshots, workstation drone status
7. **Update prepare-usb.sh** — include Lightpanda + browser-worker in USB package

Estimated effort: 2-3 days for a working ghost worker. The browser-use lib does the heavy lifting. worker.py is ~100 lines. The drone Go changes are ~50 lines (spawn subprocess, pipe task).

## Security

Ghost workers have access to real websites with real accounts. Security is critical:

- **Law Two applies to ALL external browser actions** — no auto-approve for form submissions, payments, or posts
- **Credential isolation** — browser cookies/sessions stored per-drone in sandboxed profile directories. Never shared across drones.
- **Network restriction** — ghost workers can only access URLs whitelisted in the task config. Default: deny. Queen must explicitly allow domains.
- **Screenshot audit trail** — every browser session captures screenshots at key decision points. Stored in Queen's data directory. Operator can review.
- **No credential storage in DRONE.md** — passwords, API keys, session tokens NEVER written to the learning file. Credentials passed per-task in the payload, not persisted.

## The Operator Persona

The three base personas (Researcher, Planner, Worker) are about thinking. The Operator is about acting in the physical/digital world.

```
Researcher — finds information
Planner    — makes decisions
Worker     — creates artifacts (code, documents, content)
Operator   — executes actions (browser, keyboard, API calls)
```

A ghost worker drone runs primarily in Operator mode. But it can shift — if a browser task requires researching first (find the right form, figure out the workflow), it activates Researcher temporarily, then switches to Operator for execution. The personas compose.
