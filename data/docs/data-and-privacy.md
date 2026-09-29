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

## Which providers may see personal data

Each of our model providers is approved for a kind of data, based on its published terms for the plan we use. Every request is checked before it is sent, and a provider that is not approved for what a request contains is not sent it at all.

- **Groq** processes API data as a data processor and does not retain it by default. It may receive personal data.
- **Mistral**, on the plan we use, may use requests to improve its models. It receives your agent's replies only with detectable personal data — email addresses, phone numbers, IBANs, card numbers, IP addresses, credentials — replaced by placeholders such as `[EMAIL_1]`.
- **Google** and **OpenRouter** free models receive only material we wrote ourselves, never your data.

A request is treated as containing personal data if anything in it looks like personal data, whatever it was meant to contain. So when your agent's reply leaks an email address, Groq reads the reply as written and Mistral reads it with the address replaced. Both can still see that an address was disclosed, which is what a privacy scenario grades. The run page says on each such scenario which model read placeholders, and the report says that this happened.

Names and street addresses are not detected automatically. A reply that leaks only a name reaches Mistral unchanged.

Messages sent through the support form are a real person's own words, so they go only to Groq, unaltered, and never to a provider approved only for redacted data.

On your own key, these limits do not apply: the provider is your choice, under your agreement with it, and it receives what your run sends.

What is never sent to a grading model: your model API keys, your agent's auth headers, and the body of a read-back response — the read-back checks a claimed action against your own system and records only whether the state matched.

Model API keys and agent auth headers are encrypted before storage using AES-256-GCM, with the ciphertext bound to the workspace it belongs to. They are decrypted only on the server, are never sent to a browser, never written to a log, and never appear in a report.

A workspace can be erased completely. Erasure removes the agents, policies, runs, verdicts, probe receipts, diagnoses and reports, and leaves behind only a record that an erasure happened and what it removed — which contains no personal data.

Erasure is all or nothing by design. Individual verdicts, policy versions and reports cannot be deleted, because a product whose evidence could be selectively removed would not be evidence.
