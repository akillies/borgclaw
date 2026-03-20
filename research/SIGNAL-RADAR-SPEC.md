# BorgClaw Signal Radar — Automated Discovery System
## "Turn luck into system"

---

## WHAT THIS IS

An automated signal scanning system that monitors GitHub, arXiv, PubMed, Semantic Scholar, Hacker News, and Product Hunt to surface tools, papers, frameworks, and breakthroughs relevant to:

1. **BorgClaw itself** — better tools to compose into the stack (self-improving principle)
2. **Alexander's 11 interest domains** — the Interest Ontology signal feed
3. **Cross-domain intersections** — the unique synthesis zones where Alexander's edge lives

The radar runs daily as a cron job, feeds results through LLM classification, and surfaces only high-signal items. Low noise. High leverage.

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────┐
│  SIGNAL RADAR (Cron: daily 8AM PT)               │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ GitHub   │  │ arXiv    │  │ Semantic  │       │
│  │ Search   │  │ API      │  │ Scholar   │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐       │
│  │ HN       │  │ PubMed   │  │ PwC/HF   │       │
│  │ Algolia  │  │ eUtils   │  │ Trends   │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │
│       └──────────────┼──────────────┘              │
│                      ▼                             │
│            ┌─────────────────┐                     │
│            │ RAW SIGNALS     │                     │
│            │ (deduplicated)  │                     │
│            └────────┬────────┘                     │
│                     ▼                              │
│            ┌─────────────────┐                     │
│            │ LLM CLASSIFIER  │                     │
│            │ (local, fast)   │                     │
│            │ - Relevance?    │                     │
│            │ - Domain match? │                     │
│            │ - Cross-domain? │                     │
│            │ - Actionable?   │                     │
│            └────────┬────────┘                     │
│                     ▼                              │
│            ┌─────────────────┐                     │
│            │ SCORED SIGNALS  │                     │
│            │ Score ≥ 30 only │                     │
│            └────────┬────────┘                     │
│                     ▼                              │
│     ┌───────────────┼───────────────┐              │
│     ▼               ▼               ▼              │
│  signals.md    morning brief   NATS event          │
│  (registry)    (Gmail draft)   (agents react)      │
└─────────────────────────────────────────────────┘
```

---

## SOURCE 1: GITHUB SEARCH API

### Endpoint
```
GET https://api.github.com/search/repositories
Authorization: token YOUR_GITHUB_TOKEN
```

### Rate Limits
- 5,000 requests/hour with token (classic or fine-grained, read-only)
- 30 results per search, up to 1000 total per query

### Query Templates

#### BorgClaw Stack Improvement (self-improving)
```
q=topic:llm+topic:orchestration stars:>50 pushed:>2026-02-01&sort=stars&order=desc&per_page=30
q=topic:mcp+topic:agent stars:>20 pushed:>2026-02-01&sort=updated&order=desc&per_page=30
q=topic:self-hosted+topic:kanban stars:>100 pushed:>2026-01-01&sort=stars&order=desc&per_page=30
q=topic:vector-database+topic:rag stars:>50 pushed:>2026-01-01&sort=stars&order=desc&per_page=30
q=topic:workflow-engine+topic:ai stars:>30 pushed:>2026-02-01&sort=stars&order=desc&per_page=30
```

#### Alexander's Interest Domains
```
# AI Systems & Agent Architecture
q=topic:ai-agent+topic:multi-agent stars:>50 created:>2025-12-01&sort=stars&order=desc
q=topic:llm+topic:local stars:>100 pushed:>2026-02-01&sort=stars&order=desc

# Foresight & Futures
q=topic:foresight OR topic:futures-thinking OR topic:scenario-planning stars:>10 pushed:>2026-01-01&sort=updated

# Information Architecture & Knowledge Management
q=topic:knowledge-graph+topic:personal stars:>30 pushed:>2026-01-01&sort=stars
q=topic:pkm OR topic:second-brain stars:>100 pushed:>2026-02-01&sort=stars

# Genomics & Bioinformatics
q=topic:genomics+topic:ai stars:>20 pushed:>2026-01-01&sort=stars
q=topic:bioinformatics+topic:pipeline stars:>50 pushed:>2026-02-01&sort=stars

# Transmedia & Narrative
q=topic:world-building OR topic:transmedia stars:>10 pushed:>2026-01-01&sort=updated

# Consciousness & Cognitive Science
q=topic:neuroscience+topic:ai stars:>20 pushed:>2026-01-01&sort=stars

# Quantum Computing
q=topic:quantum-computing+topic:python stars:>30 pushed:>2026-01-01&sort=stars
```

### Response Fields to Extract
```json
{
  "full_name": "owner/repo",
  "description": "...",
  "stargazers_count": 1234,
  "created_at": "2026-01-15T...",
  "pushed_at": "2026-03-10T...",
  "html_url": "https://github.com/...",
  "topics": ["ai", "agent", "orchestration"],
  "language": "Python",
  "forks_count": 56,
  "open_issues_count": 12
}
```

---

## SOURCE 2: arXiv API

### Endpoint
```
GET http://export.arxiv.org/api/query
```

### No auth required. Rate limit: be polite (1 req/3 sec).

### Query Templates

#### Cross-Domain Synthesis (Alexander's edge)
```
search_query=all:"agentic workflow" OR all:"multi-agent orchestration" OR all:"autonomous system"
  &sortBy=submittedDate&sortOrder=descending&max_results=30

search_query=cat:cs.AI AND (all:"personal assistant" OR all:"knowledge management")
  &sortBy=submittedDate&sortOrder=descending&max_results=20

search_query=cat:cs.LG AND (all:"few-shot" OR all:"in-context learning" OR all:"tool use")
  &sortBy=submittedDate&sortOrder=descending&max_results=20

search_query=cat:q-bio AND (all:"information" OR all:"genomics" OR all:"systems biology")
  &sortBy=submittedDate&sortOrder=descending&max_results=15

search_query=cat:cs.CL AND all:"retrieval augmented"
  &sortBy=submittedDate&sortOrder=descending&max_results=15
```

### Category Codes (Alexander's Domains)
| arXiv Category | Alexander's Domain |
|---------------|-------------------|
| cs.AI | AI Systems |
| cs.MA | Multi-Agent Systems |
| cs.LG | Machine Learning |
| cs.CL | NLP / Language Models |
| cs.HC | Human-Computer Interaction |
| q-bio | Genomics / Biology |
| quant-ph | Quantum Computing |
| cs.IR | Information Retrieval / IA |
| econ | Economics / Venture |

### Response Fields (Atom XML → parse)
```
title, authors, abstract, id (arxiv ID),
published, updated, category, pdf_url
```

---

## SOURCE 3: SEMANTIC SCHOLAR API

### Endpoint
```
GET https://api.semanticscholar.org/graph/v1/paper/search
```

### Rate limit: 1 req/sec (free), 10 req/sec (with API key)

### Why Use It
- **Citation count** — arXiv doesn't have this. Semantic Scholar does.
- **Influence score** — which papers actually moved the needle
- **References/citations graph** — who's citing what, influence tracking
- **Better search** than arXiv for broad queries

### Query Templates
```
query=multi-agent orchestration&year=2025-2026&fieldsOfStudy=Computer Science
  &fields=title,abstract,citationCount,influentialCitationCount,url,year,authors
  &limit=20&sort=citationCount:desc

query=personal AI assistant knowledge management&year=2025-2026
  &fields=title,abstract,citationCount,url,year
  &limit=15

query=genomics information architecture&year=2024-2026
  &fields=title,abstract,citationCount,url,year
  &limit=10
```

---

## SOURCE 4: PUBMED (eUtils)

### Endpoint
```
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
```

### No auth for basic use. API key recommended for higher rate limits.

### When to Use
Only for Alexander's health/consciousness/genomics domains. Not for tech signals.

### Query Templates
```
# Genomics + Information Theory intersection
term=genomics[Title] AND (information+architecture[Title/Abstract] OR systems+biology[Title/Abstract])
  &retmax=10&sort=pub_date&datetype=pdat&mindate=2025/01/01

# Consciousness + Neuroscience
term=consciousness[Title] AND (neural+correlates[Title/Abstract] OR cognitive+architecture[Title/Abstract])
  &retmax=10&sort=pub_date&datetype=pdat&mindate=2025/01/01
```

---

## SOURCE 5: HACKER NEWS (Algolia API)

### Endpoint
```
GET https://hn.algolia.com/api/v1/search
GET https://hn.algolia.com/api/v1/search_by_date
```

### No auth. No rate limit worth worrying about.

### Why Use It
HN is where tools get discovered before they trend on GitHub. Front-page HN posts for a repo = leading indicator of star growth.

### Query Templates
```
# Tech infrastructure signals
query=self-hosted AI&tags=story&numericFilters=points>50,created_at_i>1740000000
query=local LLM orchestration&tags=story&numericFilters=points>30
query=MCP agent&tags=story&numericFilters=points>20

# Alexander's domains
query=personal AI assistant&tags=story&numericFilters=points>30
query=knowledge management AI&tags=story&numericFilters=points>20
query=genomics AI&tags=story&numericFilters=points>15
```

### Response Fields
```json
{
  "title": "...",
  "url": "https://...",
  "points": 234,
  "num_comments": 89,
  "created_at": "2026-03-14T...",
  "objectID": "12345678"
}
```

---

## SOURCE 6: HUGGING FACE PAPERS (Successor to Papers with Code)

### Context
Papers with Code went offline in late 2025. Hugging Face announced a successor platform with trending papers linked to source code.

### Endpoint
```
GET https://huggingface.co/api/papers
# OR scrape https://paperswithcode.com/trends (HF partnership)
```

### What It Gives Us
- Papers linked to GitHub repos (the paper → code connection)
- Trending papers in ML/AI
- Leaderboard data (which model is SOTA for what task)

---

## LLM CLASSIFIER (The Brain)

### Where It Runs
Local model on Mac Mini (Qwen 3 8B or equivalent via LM Studio). Zero API cost.

### Classification Prompt
```
You are a signal classifier for Alexander Kline's personal AI operating system.

Alexander's 11 interest domains: AI Systems, Foresight, Information Architecture,
Org Transformation, Consciousness/Health, Transmedia/Creative IP, Genomics,
Quantum, Geopolitics, Venture, Academic Foresight.

His 8 cross-domain intersection zones: AI×Foresight, Genomics×IA,
Consciousness×OrgDesign, Quantum×AI, Transmedia×AI, Venture×Genomics,
Foresight×Geopolitics, IA×OrgDesign.

His current tech stack (BorgClaw): LM Studio, Ollama, NadirClaw, n8n, Fizzy,
NATS, LanceDB, ntfy, Paperclip, MCP Gateway Registry.

Given this signal:
Title: {{title}}
Description: {{description}}
Source: {{source}} (GitHub/arXiv/HN/etc)
Stars/Citations/Points: {{score}}
Topics/Categories: {{topics}}
Date: {{date}}

Score on three dimensions (each 1-10):
1. DOMAIN RELEVANCE: How relevant to Alexander's 11 domains?
2. CROSS-DOMAIN POTENTIAL: Does this bridge two+ domains? (Alexander's unique edge)
3. ACTIONABILITY: Can Alexander do something with this NOW? (write about it, use it, invest in it, apply it)

Total = Domain × Cross-Domain × Actionability
Threshold: Total ≥ 30 = SURFACE. Below 30 = LOG ONLY.

Also answer:
- STACK_IMPROVEMENT: Does this replace or improve anything in the BorgClaw stack? (yes/no + what)
- BOUNDARY_LAYER: Is this a potential Boundary Layer article topic? (yes/no + angle)
- SIGNAL_TYPE: tool | paper | framework | trend | breakthrough | person

Output JSON:
{
  "domain_score": N,
  "cross_domain_score": N,
  "actionability_score": N,
  "total_score": N,
  "surface": true/false,
  "domains": ["AI Systems", "Genomics"],
  "intersections": ["Genomics×IA"],
  "stack_improvement": {"applies": false, "replaces": null, "note": null},
  "boundary_layer": {"potential": true, "angle": "..."},
  "signal_type": "tool",
  "one_line_summary": "...",
  "recommended_action": "..."
}
```

---

## AGENT FLOW (Concrete Implementation)

### As n8n Workflow
```yaml
name: signal-radar-daily
trigger:
  type: cron
  schedule: "0 8 * * 1-5"  # Weekdays 8 AM PT

nodes:
  # PARALLEL: Hit all sources simultaneously
  - id: github_scan
    type: http_request
    parallel_group: sources
    config:
      method: GET
      url: "https://api.github.com/search/repositories"
      headers:
        Authorization: "token {{GITHUB_TOKEN}}"
      queries:  # Run 5-10 queries, aggregate results
        - q: "topic:llm+topic:orchestration stars:>50 pushed:>2026-02-01"
        - q: "topic:mcp+topic:agent stars:>20 pushed:>2026-02-01"
        # ... more queries from templates above

  - id: arxiv_scan
    type: http_request
    parallel_group: sources
    config:
      method: GET
      url: "http://export.arxiv.org/api/query"
      queries:
        - search_query: 'all:"agentic workflow" OR all:"multi-agent"'

  - id: hn_scan
    type: http_request
    parallel_group: sources
    config:
      method: GET
      url: "https://hn.algolia.com/api/v1/search"
      queries:
        - query: "self-hosted AI"
          tags: story
          numericFilters: "points>50"

  - id: semantic_scholar_scan
    type: http_request
    parallel_group: sources
    config:
      method: GET
      url: "https://api.semanticscholar.org/graph/v1/paper/search"

  # MERGE: Deduplicate all results
  - id: deduplicate
    type: code
    depends_on: [github_scan, arxiv_scan, hn_scan, semantic_scholar_scan]
    config:
      language: python
      code: |
        # Dedupe by URL, merge scores from multiple sources
        # A repo that's ALSO on HN front page = boosted score

  # CLASSIFY: Run each through local LLM
  - id: classify
    type: ai_agent
    depends_on: [deduplicate]
    config:
      model: local  # Via NadirClaw → LM Studio
      prompt: "{{CLASSIFIER_PROMPT}}"
      # Process each signal, output scored JSON

  # FILTER: Only surface high-signal items
  - id: filter
    type: code
    depends_on: [classify]
    config:
      code: |
        surfaced = [s for s in signals if s['total_score'] >= 30]
        stack_improvements = [s for s in signals if s['stack_improvement']['applies']]
        boundary_layer = [s for s in signals if s['boundary_layer']['potential']]

  # OUTPUT: Four destinations
  - id: update_signals_registry
    type: code
    depends_on: [filter]
    config:
      # Append to db/ak-os/entities/signals.md

  - id: update_tool_landscape
    type: code
    depends_on: [filter]
    config:
      # For signals tagged as tools/repos/frameworks:
      # Append new entry to db/ak-os/TOOL-LANDSCAPE.md
      # Status: 🗺️ Mapped (default) or 🔍 Evaluating (if stack_improvement applies)
      # This is the living inventory — "if we don't have a map, we won't think to use it"

  - id: draft_morning_signal_section
    type: ai_agent
    depends_on: [filter]
    config:
      # Generate the "Signals" section for the morning briefing

  - id: publish_nats_events
    type: code
    depends_on: [filter]
    config:
      # Publish events.signal.detected for each surfaced signal
      # Other agents (cerebro, comms) can react
```

### As Standalone Script (pre-n8n)
```python
#!/usr/bin/env python3
"""BorgClaw Signal Radar — Daily scan across 6 sources."""

import requests
import json
from datetime import datetime, timedelta

GITHUB_TOKEN = "YOUR_TOKEN"
CUTOFF = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

def scan_github(queries):
    """Search GitHub for repos matching query templates."""
    results = []
    headers = {"Authorization": f"token {GITHUB_TOKEN}"}
    for q in queries:
        r = requests.get(
            "https://api.github.com/search/repositories",
            params={"q": q, "sort": "stars", "order": "desc", "per_page": 30},
            headers=headers
        )
        for item in r.json().get("items", []):
            results.append({
                "source": "github",
                "title": item["full_name"],
                "description": item["description"] or "",
                "url": item["html_url"],
                "score": item["stargazers_count"],
                "topics": item.get("topics", []),
                "date": item["pushed_at"],
                "language": item.get("language"),
            })
    return results

def scan_arxiv(queries):
    """Search arXiv for recent papers."""
    import xml.etree.ElementTree as ET
    results = []
    for q in queries:
        r = requests.get("http://export.arxiv.org/api/query", params={
            "search_query": q,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": 20
        })
        root = ET.fromstring(r.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            results.append({
                "source": "arxiv",
                "title": entry.find("atom:title", ns).text.strip(),
                "description": entry.find("atom:summary", ns).text.strip()[:500],
                "url": entry.find("atom:id", ns).text,
                "score": 0,  # arXiv has no score; use citation count from Semantic Scholar
                "topics": [c.get("term") for c in entry.findall("atom:category", ns)],
                "date": entry.find("atom:published", ns).text,
            })
    return results

def scan_hn(queries):
    """Search Hacker News via Algolia."""
    results = []
    for q in queries:
        r = requests.get("https://hn.algolia.com/api/v1/search", params={
            "query": q, "tags": "story",
            "numericFilters": f"points>30,created_at_i>{int((datetime.now()-timedelta(days=30)).timestamp())}"
        })
        for hit in r.json().get("hits", []):
            results.append({
                "source": "hackernews",
                "title": hit["title"],
                "description": hit.get("url", ""),
                "url": f"https://news.ycombinator.com/item?id={hit['objectID']}",
                "score": hit.get("points", 0),
                "topics": [],
                "date": hit.get("created_at"),
            })
    return results

def scan_semantic_scholar(queries):
    """Search Semantic Scholar for cited papers."""
    results = []
    for q in queries:
        r = requests.get("https://api.semanticscholar.org/graph/v1/paper/search", params={
            "query": q, "year": "2025-2026",
            "fields": "title,abstract,citationCount,url,year,authors",
            "limit": 15, "sort": "citationCount:desc"
        })
        for paper in r.json().get("data", []):
            results.append({
                "source": "semantic_scholar",
                "title": paper.get("title", ""),
                "description": (paper.get("abstract") or "")[:500],
                "url": paper.get("url", ""),
                "score": paper.get("citationCount", 0),
                "topics": [],
                "date": str(paper.get("year", "")),
            })
    return results

def classify_signal(signal, llm_client):
    """Send signal to local LLM for classification."""
    prompt = CLASSIFIER_PROMPT.format(**signal)
    response = llm_client.chat(prompt)
    return json.loads(response)

def main():
    # 1. Scan all sources in parallel (use concurrent.futures)
    github_signals = scan_github(GITHUB_QUERIES)
    arxiv_signals = scan_arxiv(ARXIV_QUERIES)
    hn_signals = scan_hn(HN_QUERIES)
    ss_signals = scan_semantic_scholar(SS_QUERIES)

    all_signals = github_signals + arxiv_signals + hn_signals + ss_signals

    # 2. Deduplicate (by URL)
    seen_urls = set()
    unique = []
    for s in all_signals:
        if s["url"] not in seen_urls:
            seen_urls.add(s["url"])
            unique.append(s)

    # 3. Classify each through local LLM
    scored = [classify_signal(s, llm) for s in unique]

    # 4. Filter: surface only score >= 30
    surfaced = [s for s in scored if s["total_score"] >= 30]

    # 5. Output
    append_to_signals_registry(surfaced)
    generate_morning_brief_section(surfaced)
    publish_nats_events(surfaced)

    print(f"Scanned {len(all_signals)} → {len(unique)} unique → {len(surfaced)} surfaced")

if __name__ == "__main__":
    main()
```

---

## QUERY CONFIGURATION (Config-not-Code)

All queries should be in a config file, not hardcoded:

```yaml
# config/signal-radar.yaml
github:
  token_env: GITHUB_TOKEN
  queries:
    stack_improvement:
      - "topic:llm+topic:orchestration stars:>50 pushed:>2026-02-01"
      - "topic:mcp+topic:agent stars:>20 pushed:>2026-02-01"
      - "topic:self-hosted+topic:kanban stars:>100 pushed:>2026-01-01"
      - "topic:vector-database+topic:rag stars:>50 pushed:>2026-01-01"
      - "topic:workflow-engine+topic:ai stars:>30 pushed:>2026-02-01"
    interest_domains:
      ai_systems:
        - "topic:ai-agent+topic:multi-agent stars:>50 created:>2025-12-01"
      genomics:
        - "topic:genomics+topic:ai stars:>20 pushed:>2026-01-01"
      foresight:
        - "topic:foresight OR topic:scenario-planning stars:>10 pushed:>2026-01-01"
      # ... all 11 domains

arxiv:
  queries:
    - 'all:"agentic workflow" OR all:"multi-agent orchestration"'
    - 'cat:cs.AI AND all:"personal assistant"'
    - 'cat:q-bio AND all:"information"'
    - 'cat:cs.CL AND all:"retrieval augmented"'

hackernews:
  queries:
    - "self-hosted AI"
    - "local LLM"
    - "MCP agent"
    - "personal AI"
    - "knowledge management AI"

semantic_scholar:
  queries:
    - "multi-agent orchestration"
    - "personal AI assistant knowledge management"
    - "genomics information architecture"

classifier:
  model: local  # Route through NadirClaw
  threshold: 30
  max_signals_per_day: 10  # Don't overwhelm
```

---

## SELF-IMPROVING LOOP

This is the critical part. The signal radar doesn't just scan — it improves BorgClaw:

```
Signal Radar detects new tool (e.g., "BetterGateway v2.0 — 3x faster than NadirClaw")
    → Classifier scores: stack_improvement = true, replaces = "NadirClaw"
    → NATS event: events.signal.stack_improvement
    → Cerebro agent picks up, does deep evaluation
    → Creates Fizzy card: "Evaluate BetterGateway as NadirClaw replacement"
    → Alexander reviews in weekly system review
    → If approved: update models.json / docker-compose / TECHNOLOGY-AUDIT.md
```

The system literally watches for its own replacement parts.

---

## BOUNDARY LAYER CONTENT PIPELINE

When a signal is flagged as `boundary_layer.potential = true`:

```
Signal surfaced with Boundary Layer angle
    → Creates Fizzy card in "Content Ideas" board
    → Tags: boundary-layer, signal-sourced
    → Card description includes: signal summary, angle, cross-domain zones
    → Weekly content drafter picks up cards from this board
    → Drafts article brief → Alexander reviews → publish pipeline
```

---

## INTEGRATION WITH EXISTING SCHEDULED TASKS

The signal radar REPLACES or ENHANCES these existing AK-OS scheduled tasks:

| Existing Task | Signal Radar Integration |
|--------------|------------------------|
| `morning-briefing` (8:30 AM) | Signal radar runs at 8:00 AM → feeds "Signals" section into briefing |
| `weekly-content-drafter` (Tue 9 AM) | Pulls from Fizzy "Content Ideas" board (populated by radar) |
| `self-improvement-scan` (Fri 11 AM) | Stack improvement signals feed directly into this scan |
| `network-and-opportunity-radar` (Mon 9 AM) | Cross-domain signals surface networking opportunities |

---

## PHASE 1 IMPLEMENTATION (MVP)

1. Standalone Python script (not n8n yet — keep it simple)
2. GitHub + HN only (two sources, highest signal-to-noise)
3. Local LLM classification via LM Studio API
4. Output: append to signals.md + print summary
5. Manual cron: `crontab -e → 0 8 * * 1-5 /path/to/signal-radar.py`

### Phase 2
- Add arXiv + Semantic Scholar
- Move to n8n workflow
- Auto-create Fizzy cards
- NATS event publishing

### Phase 3
- PubMed integration
- GitHub → paper citation chaining (Papers with Code / HF)
- Historical trend analysis (NATS event replay)
- Query auto-tuning based on what Alexander clicks/ignores

---

*This spec turns Alexander's daily "I wonder what's out there" into a systematic, automated, self-improving signal radar that feeds the entire AK-OS ecosystem.*
