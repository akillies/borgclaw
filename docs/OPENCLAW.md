# Using BorgClaw as the OpenClaw Compute Backend

OpenClaw runs your AI assistant. BorgClaw runs the compute underneath. Together: your assistant has a fleet.

This is a one-variable change. OpenClaw talks to whatever is at `OPENAI_BASE_URL`. Point that at BorgClaw's LiteLLM proxy and every request OpenClaw makes is now load-balanced across your drones, running locally, for free.

---

## The One-Line Change

In your OpenClaw config:

```bash
OPENAI_BASE_URL=http://QUEEN_IP:4000
```

Replace `QUEEN_IP` with your Queen machine's LAN IP (e.g., `192.168.1.50`). Run `./borgclaw connect` to print it.

That's the full integration. OpenClaw doesn't know BorgClaw exists — it just gets an OpenAI-compatible endpoint that happens to be your own hardware.

---

## What Changes for Your OpenClaw

**Inference is now load-balanced.** Requests distribute across all your drones. If you have three machines, all three share the load.

**Cost drops to zero.** Local inference — no API calls, no billing, no rate limits.

**Resilience.** Drone goes offline, LiteLLM's fallback kicks in automatically. Your assistant keeps responding.

**Speed.** Depending on your hardware, local inference on a dedicated GPU is faster than cloud round-trips.

---

## What Doesn't Change

Your OpenClaw skills, channels, memory, and config are untouched. OpenClaw just gets faster answers from a different URL. Nothing in your assistant setup needs to change.

---

## For NanoClaw Users

Same principle. In your NanoClaw container's environment:

```yaml
environment:
  OPENAI_BASE_URL: http://QUEEN_IP:4000
  OPENAI_API_KEY: your-litellm-master-key
```

The `OPENAI_API_KEY` here is BorgClaw's LiteLLM master key from your `.env` — it's not an OpenAI key. LiteLLM uses it for auth against its own proxy.

Run `./borgclaw connect` to print both values.

---

## Selecting a Model

By default, LiteLLM routes to whatever model is available across your drones. To pin OpenClaw to a specific model:

```bash
# In OpenClaw config
OPENAI_MODEL=qwen3:8b
```

Any model name your drones have pulled through Ollama is valid here. Run `./borgclaw nodes` to see what's available across the hive.

---

## Advanced: Register Queen as an OpenClaw Skill

LiteLLM at `:4000` handles inference. Queen at `:9090` handles orchestrated workflows — multi-step tasks with approval gates, scheduled jobs, and agent routing.

You can expose Queen's chat endpoint as an OpenClaw skill. This lets your assistant delegate complex work to Queen:

```json
{
  "name": "queen",
  "description": "Delegate multi-step tasks to the BorgClaw hive. Use for tasks requiring research + synthesis, scheduled work, or anything that benefits from running on dedicated hardware.",
  "url": "http://QUEEN_IP:9090/api/chat",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {{HIVE_SECRET}}"
  }
}
```

With this registered, OpenClaw can hand off tasks like "research and summarize" to Queen, who runs them across the appropriate drones, queues the result for your approval, and returns it.

---

## OpenClaw Issue #47871

The multi-machine awareness feature request ([#47871](https://github.com/OpenClaw/openclaw/issues/47871)) describes exactly this: a personal assistant that can dispatch work to multiple machines without the user managing that complexity manually.

BorgClaw addresses this at the infrastructure layer. OpenClaw delegates to a single URL. BorgClaw handles the fleet behind it — routing, load balancing, failover. The assistant author doesn't need to know about your hardware at all.

---

## Troubleshooting

**OpenClaw times out on first request.** The first inference call wakes up Ollama — it may take 10-15 seconds to load the model into memory. Subsequent calls are fast.

**"Model not found" error.** The model name OpenClaw is requesting isn't available on your drones. Run `./borgclaw nodes` and check the model column. Either pull the model on a drone (`ollama pull model-name`) or update OpenClaw's model config to match what you have.

**Slow responses despite local hardware.** Check drone contribution levels: `./borgclaw nodes`. If drones are throttled (e.g., 30% while you're using your machines), you'll see reduced throughput. Adjust via the dashboard or set an always-on worker drone to 100%.

---

Created by [Alexander Kline](https://alexanderkline.com)
