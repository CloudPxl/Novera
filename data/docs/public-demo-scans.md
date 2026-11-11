---
title: Public demo scans
published: true
---
A public demo scan lets you see how a company's public chat assistant answers six ordinary customer messages, before anyone has asked you to test it. Novera's browser worker opens the page, types each message into the chat widget, reads the reply, and Novera's AI graders judge each reply. You get a short card of what was seen, a suggested fix for each reply that fell short, and an outreach draft you can send by hand. Open it from the menu: **Public demo scans**.

It is not a run and not a report. Nothing about a scan is sealed, scored as a grade or presented as evidence about the company's systems. A scan describes six public replies on one date, and the card says so.

## Who can use it

Owners, admins and operators of a workspace can record bots, start scans, ask for fix suggestions and write outreach drafts. Reviewers and auditors can read everything.

## Which bots can be scanned

When you record a bot, you tick what it can reach. Novera works out a category from those facts; you cannot choose it.

- **Category A**: a public demo anyone can use without an account, with no money, orders, bookings, account changes or refunds behind it. Only these are scanned.
- **Category B**: public, but it can reach money, orders or accounts. Never scanned on the live site. Offer the owner a staging evaluation instead.
- **Category C**: behind a login. Never scanned; it needs the owner's authorisation and safe test credentials.
- **Category D**: never contacted about tests: the owner declined, the site's terms prohibit automated access, or it handles sensitive personal data.

A bot you mark **do not contact** is never scanned again, and no outreach draft is written, approved or recorded for it. That mark cannot be undone.

## What the worker does, and where it stops

The worker identifies itself as `NoveraInsightBot` and follows the site's robots.txt; a page that disallows it is not opened. It sends the six messages one at a time, at least twelve seconds apart, each in a fresh browser session, and types each one exactly as written. It accepts a cookie banner once at most.

It stops, and records why, the moment the page shows a bot challenge, asks for a login or a payment, or sends the browser to another site. It never tries to get past any of these. See [what the worker does](/bot).

Limits: one scan of a bot at a time, a day between scans of the same bot, and at most ten scans per workspace in any 24 hours.

## Reading the result

The scan page shows each message as it is sent and each reply as it is graded. The **Insight card** tab gives the counts, a notable strength and a notable concern, which graders decided each reply, what was not tested and the limitations, with a plain-text copy.

A reply that never arrived, or was still changing when the wait ran out, has no result. It is never counted as a pass or a failure. If Novera's own graders were busy when a reply arrived, the reply is kept and graded again shortly. The message is not sent to the bot again.

## Fixes

For each reply that failed, **Suggest a fix** asks a model for one change the bot's owner could try. The model sees only the message, what was expected, the graders' reason and the reply, so the cause it names is labelled a hypothesis, never a certainty. Before a suggestion is kept, Novera checks that every quote is in the reply word for word, that it says how to check the change worked and what it could break, and that it makes no claim of compliance. Each suggestion ends with the same sentence of what it does not prove. You accept or reject it; a rejection keeps your reason.

## Outreach

**Outreach** writes a draft from a fixed template and the card's own figures, never from a model's text and never quoting a reply. Every draft says who ran the test, that you are not affiliated with the company, how the worker identifies itself, and how to opt out. A draft goes from **draft** to **approved** to **sent** to **outcome**, one step at a time. Novera never sends it: you copy it and send it yourself, then record that you did and what came of it. No recipient address is stored. If they ask not to be contacted, record that outcome; the bot is marked do not contact.

## Handoff

When the owner wants a full evaluation, connect a staging copy of their agent in **Agents**, with their authorisation attested there, and link it on the bot's **Handoff** tab. From then on it is an ordinary agent: its runs are graded the usual way, and their reports are sealed. A Category B or C bot can be tested only this way.

## After the owner changes something

Scan the bot again. Once there are two graded scans, the bot's overview compares them scenario by scenario: **resolved** (failed before, passes now), **regressed** (passed before, fails now), and what did not move. A scenario with no result in either scan shows no movement either way.

## What a scan cannot tell you

- Anything behind the widget: orders, refunds, account changes, tool use or actions in the company's systems.
- How the bot answers anything other than these six messages, or on another day.
- Whether the company meets any law. A scan is not a security test and not a certification.
