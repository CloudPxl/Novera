---
title: Integration with LangGraph (Python)
published: true
---
This guide wraps a LangGraph graph in a FastAPI endpoint that Novera can call, protected by a test credential in a request header, and returns the graph's tool calls so they can be graded. The Novera side is the HTTP connection described in [Connecting an agent](/docs/connecting-an-agent). The Python side was written against `fastapi`, `langgraph` and `langchain-core` as of 2026; the graph itself is your own, so only the parts that touch messages and tool calls are shown.

## The contract

Novera sends one `POST` per scenario message with a JSON body built from your template. The placeholders it fills are `{{input}}` (the customer's message, required), `{{history}}` (earlier turns, as `{ "role": "user" | "assistant", "content": … }`, not including the current message), `{{conversation_id}}` (stable across the turns of one scenario), `{{context}}` (what the agent is told about the conversation rather than by the customer, as JSON text) and `{{policy}}`. Any other placeholder is refused when you save the connection.

Two of them switch scenarios on. Without `{{history}}` or `{{conversation_id}}`, multi-turn scenarios are recorded as not run. Without `{{context}}`, scenarios that deliver an injection through the context channel are recorded as not run. Neither is sent to your agent as an ordinary message, because that would be a different test.

## The connection in Novera

On the agent's **Connection** tab:

- Endpoint URL: the public https address of the endpoint, for example `https://agent.example.com/support`. Private and loopback addresses are refused.
- Request body template:

```json
{
  "message": "{{input}}",
  "history": "{{history}}",
  "thread_id": "{{conversation_id}}",
  "context": "{{context}}"
}
```

- Reply path: `reply`
- Tool activity path: `tool_activity`
- Auth header name: `X-Test-Token`, with a long random credential as its value. It is encrypted before storage, decrypted only on the server, and never shown again. To change the address of an agent that has a stored credential, you paste the credential again or remove it, so it never follows its address to another host.

## The endpoint

```python
import hmac
import json
import os

from fastapi import FastAPI, Header, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel

from my_agent import graph  # your compiled LangGraph graph, with a checkpointer

app = FastAPI()


class SupportRequest(BaseModel):
    message: str
    history: list[dict] = []
    thread_id: str
    context: str = "{}"


@app.post("/support")
def support(body: SupportRequest, x_test_token: str = Header(default="")):
    # Only Novera's test credential gets in. Constant-time comparison.
    expected = os.environ["NOVERA_TEST_TOKEN"]
    if not hmac.compare_digest(x_test_token, expected):
        raise HTTPException(status_code=401, detail="unauthorised")

    try:
        context = json.loads(body.context)
    except ValueError:
        context = {}

    # {{history}} holds earlier turns only; the current message arrives in `message`.
    earlier = [
        HumanMessage(content=t["content"]) if t.get("role") == "user" else AIMessage(content=t["content"])
        for t in body.history
    ]

    # A fresh thread per conversation: Novera sends the same thread_id on each turn of
    # one scenario and a new one for the next, so scenarios never share state.
    config = {"configurable": {"thread_id": body.thread_id}}
    state = graph.invoke(
        {"messages": [*earlier, HumanMessage(content=body.message)], "context": context},  # "context" must be a key of your graph state
        config,
    )

    messages = state["messages"]

    # Only the messages produced for this turn: everything after the last human message.
    last_human = max(i for i, m in enumerate(messages) if isinstance(m, HumanMessage))
    this_turn = messages[last_human + 1 :]

    results = {m.tool_call_id: m.content for m in this_turn if isinstance(m, ToolMessage)}
    tool_activity = [
        {"tool": call["name"], "arguments": call["args"], "result": results.get(call["id"])}
        for m in this_turn
        if isinstance(m, AIMessage)
        for call in (m.tool_calls or [])
    ]

    reply = next((m.content for m in reversed(this_turn) if isinstance(m, AIMessage) and m.content), "")
    return {"reply": reply, "tool_activity": tool_activity}
```

The endpoint is synchronous on purpose, so FastAPI runs it in a worker thread and the graph can block. If your graph is async, use `await graph.ainvoke(...)` in an `async def`.

If your graph uses a checkpointer and you pass the full history as well as a `thread_id`, the thread may already contain those turns and the agent would see them twice. Use one or the other: either send `history` and give each request a throw-away thread, or rely on the thread and ignore `history`. Whichever you choose, keep it the same in production and in the test, so Novera tests the behaviour your customers get.

## The tool activity

Scenarios can check what the agent did as well as what it said: that a tool was called, was not called, was called in a given order, or was called with an argument that must not appear. They read the list at the **Tool activity path**. For each step Novera reads the name from `tool`, `name`, `tool_name` or `function_name`, the arguments from `arguments`, `args`, `input` or `parameters`, and the result from `result`, `output` or `response`; the endpoint above uses `tool`, `arguments` and `result`. A step with an `error` or a `status` of `failed` is read as failed, and a step with no result as unknown, never as a success.

The reply must be a non-empty string at the reply path. If it is not, the scenario is recorded as no answer with the path it looked at and a hint of where the text appears to be, and a no-answer is never counted as a pass.

## The test credential

The `X-Test-Token` header is a credential for Novera and nothing else.

- Scope it to a test agent: a deployment with test data and stubbed tools, never the deployment your customers use. Anyone who holds the value can send messages to the endpoint, so treat it as a secret and rotate it by pasting a new value in Novera and changing the environment variable.
- Do not reuse a production API key as the header value. Novera stores the value encrypted and never writes it to logs or reports, but a dedicated value limits what a leak could do.
- Keep the check in the endpoint itself. A path that Novera can reach and that skips the check is a path anyone can reach.

## Test target, not production

An agent is treated as production until an owner or admin marks it as a test target on its **Connection** tab, and that change is confirmed and written to the audit trail. A scenario marked `destructive` or `fixture_only` is never run against an agent still marked production: it is recorded as producing no result, with the reason, rather than quietly skipped. So that a destructive scenario can run, the agent has to be a test target, and its tools have to be stubs. A tool that really issues refunds or deletes records does not belong behind a test target.

You must own the agent or be authorised to test it. That confirmation is recorded and copied onto every run.

## Before you run

Connecting the agent sends one harmless request and saves the reply as a receipt. Read it first: it shows whether the reply path and the tool activity path found what you expected, and whether the credential was accepted. Then run the suite from the agent's page, from a pipeline as in [the GitHub Actions guide](/docs/integration-github-actions), or on a schedule.
