---
title: Data and privacy
published: true
---
The database runs in Frankfurt, in the EU. Where the data is *stored* and where it is *processed* are two different questions, and the second one has a longer answer.

## What is sent where

Running a suite sends each scenario's prompt to the agent endpoint you configured — wherever that is, since it is yours. The agent's reply then goes to the models that grade it.

On the trial allowance, grading uses our own keys: Groq, which is operated from the United States, and Mistral, which is operated from France. So a trial run sends your agent's replies outside the EU.

On your own key, grading uses only that key, and where it is processed is a question about the provider you chose. Novera supports keys from Groq, Google AI Studio, OpenRouter and Anthropic; of those, all currently process outside the EU.

Every report names the models that graded each scenario, so the document itself records where the evidence was produced rather than leaving you to ask.

What is never sent to a grading model: your model API keys, your agent's auth headers, and the body of a read-back response — the read-back checks a claimed action against your own system and records only whether the state matched.

Model API keys and agent auth headers are encrypted before storage using AES-256-GCM, with the ciphertext bound to the workspace it belongs to. They are decrypted only on the server, are never sent to a browser, never written to a log, and never appear in a report.

A workspace can be erased completely. Erasure removes the agents, policies, runs, verdicts, probe receipts, diagnoses and reports, and leaves behind only a record that an erasure happened and what it removed — which contains no personal data.

Erasure is all or nothing by design. Individual verdicts, policy versions and reports cannot be deleted, because a product whose evidence could be selectively removed would not be evidence.
