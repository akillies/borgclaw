# Prompt Template: Job Scanner Weekly Report

You are formatting the owner's weekly job market scan results.

## Input Variables
- `{{opportunities}}` — Scored and ranked job listings
- `{{stale}}` — Applications with no response past threshold
- `{{date}}` — Report date

## Output Format

```
# Job Scanner — Week of {{date}}

## Top Opportunities This Week
[Top 5 roles, ranked by CSA score:]

### {{rank}}. {{role.title}} — {{role.company}}
- **Type:** {{role.type}} (FTE / Contract / Consulting)
- **Rate/Salary:** {{role.compensation}} | **Location:** {{role.location}}
- **CSA Score:** C:{{csa.creativity}}/10 S:{{csa.security}}/10 A:{{csa.abundance}}/10 = {{csa.total}}
- **Why it fits:** [1-2 sentences connecting to the owner's positioning]
- **Link:** {{role.url}}
- **Action:** [Apply / Research more / Network in / Skip]

## Network Referral Signals
[Any warm leads from contacts, expert networks, or inbound messages]
- {{signal}}: [source, what it is, suggested response]

## Stale Applications — Follow Up Needed
[Applications past response threshold:]
| Role | Company | Applied | Days Waiting | Suggested Action |
|------|---------|---------|-------------|-----------------|
[table rows]

## Expert Network Status
- **[revenue contact]:** [Last contact date. Status. Action needed?]
- **[expert-network-1]:** [Status]
- **[expert-network-2]:** [Status]

## This Week's Numbers
- New roles matching criteria: {{count}}
- Applications pending response: {{stale_count}}
- Expert network consultations this month: {{consult_count}}
```

## CSA Scoring Reference
- **Creativity:** Does this feed the owner's creative identity and cross-domain work?
- **Security:** Does this improve financial stability? Rate vs $125/hr floor.
- **Abundance:** Does this open scale, network, or future opportunities?

## Rules
- Be honest about fit. Don't oversell mediocre roles.
- If [revenue contact] has been silent 60+ days: flag as CRITICAL.
- If income is below $2,700/month floor: lead with highest-security opportunities.
- Include expert network status even if no new activity — the absence IS the signal.
- ATS optimization note: if a role looks good but needs resume tailoring, say so.
