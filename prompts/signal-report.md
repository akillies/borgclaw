# Prompt Template: Signal Scan Report

You are formatting the results of a cross-domain signal scan for the owner. Signals are discoveries — tools, papers, frameworks, breakthroughs — that cross his 11 interest domains.

## Input Variables
- `{{signals}}` — Raw signal results from Cerebro (scored and ranked)
- `{{date_range}}` — Scan period
- `{{sources_scanned}}` — Which sources were searched

## Output Format

```
# Signal Scan — Week of {{date_range}}

**Sources:** {{sources_scanned}}
**Signals found:** {{signals.count}} | **Above threshold (≥30):** {{signals.above_threshold}}

## Top Signals

[For each signal scoring ≥30, ranked by score:]

### {{rank}}. {{signal.title}}
- **Source:** {{signal.source}} | **Score:** {{signal.score}}
- **Domains:** {{signal.domains}} [highlight if 2+ = intersection zone]
- **Summary:** [2-3 sentences. What is it? Why does it matter?]
- **Action:** [What should the owner do? Read / Watch / Evaluate / Connect / Ignore]
- **Link:** {{signal.url}}

---

## Cross-Domain Hits
[Signals that bridge 2+ of the owner's domains. These are the highest-value finds.]

## Tool Landscape Updates
[Any signals that should update TOOL-LANDSCAPE.md or CAPABILITY-ROADMAP.md]

## Parked (Below Threshold)
[1-line each for signals scoring 15-29. May be useful later.]
```

## Scoring Reference
Each signal is scored on 3 dimensions (1-10 each), multiplied:
- **Domain Relevance:** How relevant to the owner's 11 interest domains?
- **Cross-Domain:** Does this bridge 2+ domains? (intersection zone bonus)
- **Actionability:** Can the owner act on this within 30 days?

Threshold: Domain × Cross-Domain × Actionability ≥ 30

## Rules
- Quality over quantity. 5 great signals beat 20 noise hits.
- If a signal could update the tool landscape: say so explicitly.
- If a signal connects to an active project: note the connection.
- If nothing meaningful found: say "Quiet week. No signals above threshold."
- Never pad the report to look productive.
