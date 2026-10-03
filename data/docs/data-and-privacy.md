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
- **Mistral**'s plan lets an account switch off the use of requests to improve its models; ours has it switched off. It may receive personal data.
- **Google** and **OpenRouter** free models receive only material we wrote ourselves, never your data.

A request is treated as containing personal data if anything in it looks like personal data — an email address, a phone number, an IBAN, a card number, an IP address, a credential — whatever it was meant to contain. A provider approved only for redacted data would receive such a request with those replaced by placeholders such as `[EMAIL_1]`, and the run page and the report would say so; none of the providers we use today is limited that way. Names and street addresses are not detected automatically.

On your own key, these limits do not apply: the provider is your choice, under your agreement with it, and it receives what your run sends.

What is never sent to a grading model: your model API keys, your agent's auth headers, and the body of a read-back response — the read-back checks a claimed action against your own system and records only whether the state matched.

Model API keys and agent auth headers are encrypted before storage using AES-256-GCM, with the ciphertext bound to the workspace it belongs to. They are decrypted only on the server, are never sent to a browser, never written to a log, and never appear in a report.

## How long your agent's replies are kept

A run keeps what your agent actually said — each reply, whole conversations and tool activity — so a person can check a verdict against it. That text is where personal data ends up if your agent leaks it, so it is not kept indefinitely. Under **Settings → Evidence retention** the workspace owner chooses 30, 90, 180 or 365 days; the default is 180.

Once a day, replies older than the period are removed. What stays until you erase the workspace: the verdict, the reasons for it, the scenario, the checks, and a SHA-256 fingerprint of the reply taken when it was graded — so a copy you kept elsewhere can still be shown to be the one that was graded. Reports never contained your agent's replies, so no report changes. A removed reply cannot be diagnosed; retest the scenario to get a fresh one.

Shortening the period removes older replies at the next daily pass, and that cannot be undone.

## Support messages and connection checks

A message sent through the support form or a trial application is erased 90 days after the last thing that happened in that conversation — the message, a drafted reply, its approval or its sending — together with every reply drafted for it. What remains is a record that an erasure happened, with no content and nothing that identifies the sender. You can ask for erasure sooner at any time.

When Novera checks that your agent answers, it keeps a receipt of that one request. After 90 days the agent's reply in the receipt is emptied; when the check happened, the status code and how long it took are kept.

A document, page or tool list you add in the Suite Builder is stored as text, with email addresses, phone numbers, card numbers, IBANs and IP addresses replaced before it is saved; the file itself is not kept, only a SHA-256 of it. That text is emptied 180 days after it was added. The passages quoted from it, its hash and the decisions made on it remain with the suite. When you ask Novera to read it, it goes only to a model provider whose terms allow customer content, as the page says before you add anything.

Sealed reports also leave out anything shaped like personal data that a grading model quoted in its reasons: an email address in a finding is shown as a placeholder such as `[EMAIL_1]`, and the report says when that happened.

The API and the MCP server do the same by default. Your agent's replies and the scenarios' messages reach an API key only when its creator allowed it (**Can also read your agent's replies**) and the request asks for them (`include=responses`). Each such read is recorded with the key, the run and the route, and listed under **Settings → API keys**.

A workspace can be erased completely, by its owner, under **Settings → Workspace**: type the workspace's name to confirm. Erasure removes the agents, policies, runs, verdicts, probe receipts, diagnoses, reports, invitations, its audit log and its shared assistant memory, and leaves behind only a record that an erasure happened and what it removed — which contains no personal data. Report links stop working at once.

Erasure is all or nothing by design. Individual verdicts, policy versions and reports cannot be deleted, because a product whose evidence could be selectively removed would not be evidence.

## Your profile, conversations and memory

Your profile — name, title, company, timezone, date format, motion, account mode and the defaults you choose — is used only to show Novera to you. It is never read by grading, suites, policies or reports, and never appears in a report.

Your conversations with Ask Novera are stored so you can reopen them, are visible only to you (not to your teammates), and are deleted after 180 days without a new message, or when you delete them under **History**.

Assistant memory is off until you turn it on. When it is on, Ask Novera remembers only what you choose: a preference you save under **Settings → Your profile**, or a suggestion it offers and you accept with **Remember**. It never remembers customer conversations, keys, policy text or anything shaped like an instruction or a link. Memory shapes how answers are worded; it cannot change a policy, a verdict, a grade or a report. Every memory says where it came from, can be deleted on its own, and can be cleared at once.

## Members, roles and leaving

A workspace's owner and admins invite members by email, as admin, operator, reviewer or auditor. An invitation works once, only for the address it was sent to, and expires after seven days. Removing a member takes effect on their next request and revokes the API keys they created in that workspace. Changes to members, roles, keys, webhooks, retention and report withdrawal are recorded in the workspace's audit log, which cannot be edited.

**Download my data** under **Settings → Your profile** gives you your profile, memberships, memory, conversations and your own events as JSON. **Delete my account** erases the workspaces you own (they are listed first), ends your memberships elsewhere, revokes your keys there, and deletes your profile, conversations and memory. What you did in other people's workspaces stays as evidence, attributed to an identifier that no longer carries your name or email.

