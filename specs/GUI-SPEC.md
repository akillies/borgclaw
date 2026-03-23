# BorgClaw GUI Improvement Spec

## Problem

The dashboard is a single long scroll. On a 2K screen you can't see everything at once. Sections are fixed-order, can't be collapsed, can't be rearranged. The chat gets wiped by refresh. No way to toggle features like screensaver from the GUI.

## Design Principles

- BBS aesthetic stays. No frameworks. No React. Box-drawing, monospace, green on black.
- Every byte earned. No bloat.
- Works on the worst hardware in the hive.
- Every feature has a GUI surface. If it can't be done from the dashboard, it doesn't exist for most users.

---

## Phase 1: Layout Fix (priority)

### Collapsible Sections
Every section header becomes a toggle. Click to collapse/expand. State persisted in localStorage.

```
[+] NODES (4 online / 5 total)          <- collapsed, shows summary
[-] NODES (4 online / 5 total)          <- expanded, shows full table
```

Implementation: CSS `max-height: 0; overflow: hidden` on collapse. JS toggles a class. One event listener on section headers. ~20 lines.

### Tab Bar
Fixed bar at the top below the header stats. Tabs for major sections:

```
[NODES] [WORKFLOWS] [APPROVALS] [CHAT] [SECURITY] [TOOLS]
```

Click a tab: scrolls to that section AND collapses all others. Or: tabs switch visibility (show one section at a time). The second approach is cleaner for limited screens.

Implementation: each section gets `data-tab="nodes"` etc. Tab click hides all, shows selected. ~30 lines.

### Two-Column Layout (wide screens)
On screens wider than 1400px, split into two columns:
- Left: Nodes + Clusters + Metrics (the hardware view)
- Right: Workflows + Approvals + Activity (the operations view)

Chat, Connect, Security stay full-width below.

Implementation: CSS media query + grid. ~10 lines of CSS.

---

## Phase 2: Interactive Controls

### Screensaver Toggle
In the NODES section, each drone row gets a toggle:
```
drone-efef  worker  12% CPU  [SCREENSAVER: OFF]
```

Click toggles. Sends command to drone: `POST /screensaver { enabled: true/false }`

Queen stores the preference. When the drone goes idle, it either shows the screensaver or stays on the BBS terminal.

### Contribution Dial (better UX)
Current: a range slider that fires on change.
Better: a visual dial with the current value displayed prominently. Click to type a number. Drag to adjust. Debounced 500ms before sending.

```
drone-efef  [=======---] 70%  [SET]
```

### One-Click Deploy
In the NODES section, a "DEPLOY NEW DRONE" button that:
1. Shows a form: IP address, SSH user, profile (Scout/Worker/Scholar/Arsenal)
2. Calls `POST /api/hive/make-disk` or the SSH deploy path
3. Shows progress inline

### Model Swap
Click a drone's model name to see available alternatives. Click to pull/swap. Already partially built — needs polish.

---

## Phase 3: Queen Chat as First-Class Panel

### Pop-Out Chat
The /chat page exists as a standalone route. But the dashboard should have a "pop out" button that opens /chat in a new window. The embedded chat in the dashboard stays for quick questions.

### Chat History
Chat messages should persist in localStorage so they survive page loads. The standalone /chat page does this already (no refresh). The dashboard chat should too — but only if we kill the auto-refresh or make it partial (update stats without re-rendering the whole page).

### Partial Refresh
Instead of re-rendering the entire dashboard every 30 seconds, use the existing SSE stream to update individual stat counters and node rows. The HTML structure stays — only the data values change. This is the real fix for the refresh problem.

Implementation: SSE events already push to the dashboard. The `handleSSEEvent` function exists but the main IIFE script has parse issues. The standalone script should handle SSE updates by targeting specific DOM elements by ID.

---

## Phase 4: Drone Management Panel

### Per-Drone Detail View
Click a drone in the nodes table to expand a detail panel:
- Full hardware specs
- DRONE.md learned insights
- Task history (last 20)
- Model list with pull/swap
- Knowledge domains
- Contribution history sparkline
- Chat link (opens drone's BBS terminal)
- Screensaver toggle
- Kill/restart buttons

### Drone Groups
Tag drones into groups: "upstairs", "garage", "office". Filter the nodes table by group. Useful when you have 10+ drones.

---

## Phase 5: Visual Polish

### Sparkline Rendering
The sparkline data exists in the metrics history. Needs rendering in the nodes table — tiny inline charts showing CPU/tok/s trends. Use block characters: `_.-'^` or Unicode blocks.

### Status Bar
Fixed bottom bar showing:
```
QUEEN v0.2.0 | 4/5 DRONES | 0 APPROVALS | SSE: LIVE | 14:32:07
```

Always visible. No scrolling needed to see critical state.

### BBS Color Themes
Default is green-on-black. But offer:
- Amber phosphor (amber on black — classic terminal)
- Blue steel (cyan on dark blue — corporate Borg)
- Blood (red on black — aggressive mode)

Theme selector in security panel or footer. localStorage persisted.

---

## Implementation Order

1. Collapsible sections (~20 lines JS)
2. Tab bar (~30 lines JS + 10 lines CSS)
3. Two-column layout (~10 lines CSS)
4. Partial SSE refresh instead of full re-render (~50 lines JS)
5. Pop-out chat button (~5 lines)
6. Status bar (~15 lines HTML/CSS)
7. Per-drone detail view (~50 lines JS)
8. Screensaver toggle (~20 lines)
9. Sparklines (~30 lines)
10. Color themes (~20 lines CSS)

Total: ~250 lines of new code. Dashboard gets MORE capable while staying lean.

---

*Last updated: 2026-03-23*
