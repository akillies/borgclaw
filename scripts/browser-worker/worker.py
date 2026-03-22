#!/usr/bin/env python3
"""
BorgClaw Ghost Worker — Browser Automation
==========================================
Runs on old laptops that can't do LLM inference.
All LLM calls are routed to the Queen's LiteLLM endpoint.
The local machine only executes browser actions.

Usage (stdin):
    echo '{"goal":"...","queen_url":"http://10.0.0.20:4000","hive_secret":"...","max_steps":10}' | python3 worker.py

Usage (arg):
    python3 worker.py '{"goal":"...","queen_url":"http://10.0.0.20:4000","hive_secret":"...","max_steps":10}'

Output: single JSON line to stdout.
    {"status":"completed","result":"...","steps_used":5,"error":null}
    {"status":"failed","result":null,"steps_used":0,"error":"..."}
"""

import asyncio
import json
import sys
import os
import traceback


def load_task() -> dict:
    """Load task from CLI arg or stdin. Returns parsed dict."""
    if len(sys.argv) > 1:
        raw = sys.argv[1]
    else:
        raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("No task provided — pass JSON via stdin or as first argument")
    return json.loads(raw)


def validate_task(task: dict) -> None:
    """Fail fast on missing required fields."""
    required = ["goal", "queen_url"]
    missing = [k for k in required if not task.get(k)]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")


def build_llm(queen_url: str, hive_secret: str | None, model: str = "gpt-4o"):
    """
    Build an LLM instance pointed at the Queen's LiteLLM proxy (or direct Ollama).
    No local inference — all reasoning is remote.
    """
    import os
    os.environ["OPENAI_API_KEY"] = hive_secret if hive_secret else "borgclaw-ghost"
    os.environ["OPENAI_BASE_URL"] = queen_url

    from langchain_openai import ChatOpenAI

    # browser-use monkeypatches .provider and .ainvoke onto the LLM.
    # Pydantic v2 blocks setattr/getattr on undefined fields.
    # Subclass with extra="allow" so browser-use can do its thing.
    class BorgClawLLM(ChatOpenAI):
        model_config = {**ChatOpenAI.model_config, "extra": "allow"}
        provider: str = "openai"

        @property
        def model(self):
            return self.model_name

    llm = BorgClawLLM(
        model=model,
        base_url=queen_url,
        api_key=os.environ["OPENAI_API_KEY"],
        temperature=0.0,
    )
    return llm


async def run_browser_task(task: dict) -> dict:
    """
    Core execution loop.
    Hands the goal to browser-use Agent with an LLM pointed at Queen.
    """
    from browser_use import Agent

    queen_url = task["queen_url"].rstrip("/")
    hive_secret = task.get("hive_secret")
    goal = task["goal"]
    max_steps = int(task.get("max_steps", 20))
    model = task.get("model", "gpt-4o")

    llm = build_llm(queen_url, hive_secret, model)

    agent = Agent(
        task=goal,
        llm=llm,
        max_failures=3,
        calculate_cost=False,
    )

    history = await agent.run(max_steps=max_steps)

    # browser-use AgentHistoryList — extract final result
    final_result = history.final_result()
    steps_used = len(history.history) if hasattr(history, "history") else 0

    return {
        "status": "completed",
        "result": final_result,
        "steps_used": steps_used,
        "error": None,
    }


def emit(payload: dict) -> None:
    """Write result JSON to stdout and flush."""
    print(json.dumps(payload), flush=True)


def main():
    try:
        task = load_task()
    except (json.JSONDecodeError, ValueError) as e:
        emit({"status": "failed", "result": None, "steps_used": 0, "error": f"Bad input: {e}"})
        sys.exit(1)

    try:
        validate_task(task)
    except ValueError as e:
        emit({"status": "failed", "result": None, "steps_used": 0, "error": str(e)})
        sys.exit(1)

    timeout = int(task.get("timeout", 300))

    try:
        result = asyncio.run(
            asyncio.wait_for(run_browser_task(task), timeout=timeout)
        )
        emit(result)
    except asyncio.TimeoutError:
        emit({
            "status": "failed",
            "result": None,
            "steps_used": 0,
            "error": f"Task timed out after {timeout}s",
        })
        sys.exit(1)
    except Exception as e:
        emit({
            "status": "failed",
            "result": None,
            "steps_used": 0,
            "error": f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        })
        sys.exit(1)


if __name__ == "__main__":
    main()
