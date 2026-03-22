# BorgClaw Knowledge Packs

Drones can serve offline knowledge from ZIM files — the same format used by
Kiwix to distribute Wikipedia, medical references, developer docs, and other
curated knowledge bases. No internet required at query time.

---

## What Are Knowledge Packs?

A ZIM file is a compressed, indexed archive of web content. The Kiwix project
maintains thousands of them at [library.kiwix.org](https://library.kiwix.org),
ranging from a 100MB medical reference to the full English Wikipedia (22GB).

BorgClaw drones auto-detect installed ZIM files and report their availability
to the Queen on every heartbeat. The Queen can then route knowledge tasks to
whichever drones carry the relevant pack.

---

## Installing Packs on a Drone

Drop `.zim` files into the knowledge directory on the drone machine:

```
~/.config/borgclaw/knowledge/
```

The drone scans this directory on boot and on every heartbeat. No restart
required after adding new files — the drone reports the new domain on its
next heartbeat (default: every 30 seconds).

To override the default directory, set `knowledge_dir` in `drone.json`:

```json
{
  "knowledge_dir": "/mnt/data/borgclaw-knowledge"
}
```

---

## How Drones Report Knowledge

Each `.zim` filename (without the extension) becomes a **domain** name:

| Filename                       | Domain                    |
|-------------------------------|---------------------------|
| `wikimed-mini.zim`            | `wikimed-mini`            |
| `wikipedia_en_simple.zim`     | `wikipedia_en_simple`     |
| `devdocs_en_all.zim`          | `devdocs_en_all`          |
| `stackoverflow_en_mini.zim`   | `stackoverflow_en_mini`   |

On each heartbeat the drone sends its domain list to Queen:

```json
{
  "knowledge_domains": ["wikimed-mini", "devdocs_en_all"]
}
```

Queen stores this alongside the node's models, metrics, and capacity.

---

## How Queen Routes Knowledge Tasks

Send a task with a `required_domain` field to route it to a drone that has
the matching pack installed:

```bash
curl -X POST http://queen:9090/api/tasks/dispatch \
  -H "Authorization: Bearer <hive-secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "med-query-001",
    "type":    "inference",
    "model":   "phi4-mini",
    "required_domain": "wikimed-mini",
    "payload": { "prompt": "What is the treatment for hyponatremia?" }
  }'
```

Routing rules (in priority order):

1. If `required_domain` is set, only drones that report that domain are eligible.
2. Among eligible drones, prefer those with available task slots.
3. Among those, prefer by lowest queue depth.

If no online drone has the required domain, the Queen returns `503` with a
clear error rather than routing to a drone that cannot serve the pack.

To see which drones have which knowledge domains:

```bash
curl http://queen:9090/api/tasks/knowledge-nodes \
  -H "Authorization: Bearer <hive-secret>"
```

Response shape:

```json
{
  "nodes": [
    {
      "node_id": "drone-a3f2",
      "status": "online",
      "knowledge_domains": ["wikimed-mini", "wikipedia_en_simple"],
      "addr": "192.168.1.42:9091"
    }
  ],
  "domain_index": {
    "wikimed-mini": ["drone-a3f2"],
    "wikipedia_en_simple": ["drone-a3f2", "drone-b7c1"]
  }
}
```

---

## Recommended Packs

| Pack | Size | Use case | Download |
|------|------|----------|----------|
| `wikimed-mini` | ~100MB | Medical quick-reference | [library.kiwix.org](https://library.kiwix.org) — search "wikimed mini" |
| `wikipedia_en_simple` | ~1GB | General knowledge, concise | [library.kiwix.org](https://library.kiwix.org) — search "wikipedia simple" |
| `devdocs_en_all` | ~900MB | Developer docs (MDN, Python, Go, etc.) | [library.kiwix.org](https://library.kiwix.org) — search "devdocs" |
| `stackoverflow_en_mini` | ~800MB | Top Stack Overflow Q&As | [library.kiwix.org](https://library.kiwix.org) — search "stackoverflow mini" |
| `gutenberg_en_all` | ~60GB | Project Gutenberg full text | For archive nodes only |

For a Scholar USB drive (16GB), `wikimed-mini` + `wikipedia_en_simple` +
`devdocs_en_all` fit comfortably alongside the model cache.

---

## USB Drive Deployment

When using `prepare-usb.sh` with the `scholar` or `arsenal` profile, a
`knowledge/` directory is created on the drive with a README explaining
recommended packs.

To pre-load packs onto the drive before deployment:

```bash
# Prepare the drive
./scripts/prepare-usb.sh /Volumes/MYUSB --profile scholar

# Copy .zim files into the knowledge directory on the drive
cp wikimed-mini.zim /Volumes/MYUSB/THE-CLAW/knowledge/
cp devdocs_en_all.zim /Volumes/MYUSB/THE-CLAW/knowledge/
```

When `setup.sh` runs on the target machine, it copies all `.zim` files from
the drive's `knowledge/` directory into `~/.config/borgclaw/knowledge/`
automatically.

---

## Current Search Implementation

ZIM content search is a **stub** in the current release. The
`GET /knowledge/search?q=...&domain=...` endpoint on each drone:

- Returns `{ results: [], message: "No knowledge packs installed" }` when the
  knowledge directory is empty.
- Returns a placeholder result per matching pack when packs are installed,
  confirming the pack is present and the route is wired end-to-end.

Full ZIM content parsing (using the
[go-zim](https://github.com/tim-st/go-zim) library or an embedded Kiwix
server) is a planned Phase 2 enhancement. The architecture is designed so
adding real search is a drop-in replacement inside `SearchKnowledge()` in
`node/knowledge.go` — everything else (routing, heartbeat reporting, Queen
dispatch) is already in place.

---

## Architecture Summary

```
Drone boot
  └── ScanKnowledgeDomains(~/.config/borgclaw/knowledge/)
        └── reads *.zim filenames → domain list

Heartbeat (every 30s)
  └── HeartbeatPayload.knowledge_domains = ["wikimed-mini", ...]
        └── POST /api/nodes/:id/heartbeat → Queen stores domains

Task dispatch
  └── POST /api/tasks/dispatch { required_domain: "wikimed-mini" }
        └── Queen filters nodes by knowledge_domains
        └── Routes to best eligible drone
        └── Drone serves from local ZIM file
```
