---
title: The Ask Novera assistant
published: true
---
Every signed-in page has an **Ask Novera** button in the bottom-right corner. It answers questions about Novera and about your own workspace: your agents, your recent runs and their counts, and how many runs your trial has left.

## What it can do

- Explain how anything in Novera works, citing the documentation page it used.
- Tell you what happened in a run, using the counts stored for that run — it never estimates a number.
- Take you to the right place: an agent's page, a run, settings, the guide or a documentation page.
- Offer to start a run on one of your agents. That appears as a button; nothing starts until you press it, and the same checks apply as on the agent's page.

## What it cannot do

It cannot change settings, keys, policies or verdicts, and it cannot declare that you are authorised to test an agent. That declaration is recorded with every run and is what every report rests on, so you make it yourself on the connect page.

## What it sends, and who pays for it

Each question goes to the same model providers used for grading, with a short summary of your workspace (agent names and web addresses, run dates and counts) and the documentation pages most relevant to the question. Your API keys and your policy text are never sent. If a question looks like it contains an API key, it is refused before anything leaves your browser, and refused again on our server.

On the trial, answers use Novera's trial allowance. If your workspace has its own model key, answers use that key, exactly as grading does. Each person can ask up to 40 questions an hour.
