---
title: Connecting your agent, step by step (no developer needed for the first steps)
published: true
---
This page takes you from nothing to a first test of your AI support agent. Most of it needs no technical knowledge. Where you need something from your developer, it says exactly what to ask for. Developers will find the full technical detail in [Connecting an agent](/docs/connecting-an-agent).

## Before you start: what to ask your developer

Novera talks to your agent over the internet, the way a chat window on your website does. It needs four things, and your developer can answer them in a few minutes:

1. **The address.** The web address (URL) the agent answers on, starting with `https://`. It must be reachable from the public internet: Novera refuses addresses inside a private company network.
2. **How to send it a message.** What the request looks like, and where in it the customer's message goes. Many agents take a message in a field called `message`, which is what Novera sends unless you change it.
3. **Where the reply is.** In the agent's answer, which field holds the reply text. Novera looks in a field called `reply` unless you change it. For example, an agent built on a common chat interface might put it at `choices.0.message.content`.
4. **A key, if the agent needs one.** Some agents only answer requests that carry a password-like value in a header (for example a header called `authorization` holding `Bearer` and a key). If so, ask for the header's name and its value.

Optional, for later: where the agent reports the actions it took (its "tool activity"), and a read-only address in your own system that shows whether an action really happened. Both are explained below.

You can send your developer this page and the technical one, and fill in the form together.

## Try the sample agent first

If you do not have an agent address yet, or want to see a whole test before touching your own agent, press **Or try a sample support agent first**. It appears on the dashboard's getting-started steps and on the **Connect an agent** page, where this deployment offers it.

It adds **Sample support agent (Novera test fixture)**: Novera's own scripted agent, with mistakes planted on purpose, and a stand-in system that lets Novera catch a refund the agent claimed but never made. It comes with a sample policy, so you can run a test straight away. Everything it produces is labelled test data, on screen and on its report: it is never presented as a real agent. On the trial, a run against it counts as one of your three runs.

## Step 1: fill in the form

Open **Agents → Connect an agent** (also in the menu at the top right). The owner, an admin or an operator can do this.

- **Name**: what you call the agent inside Novera, for example "Shop support bot". A sealed report shows this name, so choose one you are happy for a client to read.
- **Endpoint URL**: the address from your developer.
- **Request and reply format** (closed unless you open it): leave it alone if your developer said the defaults fit.
- **Authentication** (closed unless you open it): only if the agent needs a key. Fill in **Header name** and **Header value**. The value is encrypted before it is stored and is never shown again, not even to you.

Inside **Request and reply format** are three fields:

- **Request body**: what Novera sends. Keep `{{input}}` where the customer's message goes. Your developer may add `{{policy}}` (your written rules), `{{context}}` (data about the customer, such as account details), and `{{history}}` or `{{conversation_id}}` for conversations of several messages. A scenario that needs a slot your agent does not have is recorded as not run, never sent another way.
- **Reply path**: where the reply text is, such as `reply`.
- **Tool activity path** (optional): where the agent lists the actions it took.

## Step 2: press Test connection

**Test connection** sends one short message, "Hello, this is a connection check from Novera. Please reply briefly.", from what is in the form right now. Nothing is saved, and the form keeps what you typed. It waits up to 10 seconds. What the result means:

- **Connected: HTTP 200 in … ms**, with the first part of the agent's reply. It works. Read the reply: it should be your agent talking.
- **Could not reach the endpoint within 10 s**: nothing came back. The address may have a typo, the agent may be switched off, or it may not be reachable from the internet. Check the address with your developer.
- **Not sent: this is not a public address**: the address points inside a private network. Novera only calls public addresses. Your developer needs to give you the public one.
- **The endpoint returned HTTP 401** (or **403**) **— check the header or token**: the agent was reached and refused the request. The key is missing or wrong: check **Header name** and **Header value**.
- **The endpoint answered with a redirect**: the address sends Novera somewhere else, and Novera does not follow. Ask for the final address.
- **The endpoint returned HTTP 429**: the agent is limiting how many messages it accepts. Ask your developer to allow Novera's traffic: during a test it sends at most one message every quarter of a second.
- **The endpoint returned HTTP** with another number: the agent was reached but could not answer properly. A number from 500 up means it failed on its own side; ask your developer to check its logs. Other numbers usually mean the request body is not what the agent expects.
- **HTTP 200, but there is no reply text at "reply"**: the agent answered, but the reply is somewhere else in its answer. The result lists the names of the fields it found, and when it can tell where the reply is, offers **Use this reply path**. Press it, then press **Test connection** again.
- **HTTP 200, but the reply was not JSON**, or **was too large to read**: the agent answers in a format Novera cannot read. Ask your developer.

A workspace can run 20 connection tests in ten minutes.

## Step 3: confirm you may test it, and save

Tick **I own this agent, or I am authorised to test it.** Only test agents you own, or have written permission to test. The confirmation is recorded with your role, your user id (not your email) and the date, and it is copied onto every run and report.

Press **Connect and test**. Novera saves the agent, sends one more harmless message, and keeps the answer as a **receipt** on the agent's **Connection** tab. Read it: it is how you know you are testing the agent you think you are. If that check did not work, the agent is still saved, the receipt says what went wrong, and you can fix it under **Change the connection**.

## Step 4: write the policy

Open the agent's **Policy** tab and paste the rules the agent is meant to follow: when refunds are allowed, how a customer's identity is checked, what it must never say. Every answer is judged against this text. Each save creates a new numbered version, and earlier versions are kept, so every report says exactly which rules it used.

## Step 5: production or test target

Every agent starts as **production**: Novera assumes it serves real customers. Some scenarios attempt something that cannot be undone, or only make sense against test data, and those are never sent to a production agent. They appear as not run, and the report's grade shows INCOMPLETE.

If this agent is a staging or test copy where nothing real can happen, the owner or an admin can open **Connection → Production or test target**, tick the confirmation and press **Mark as a test target**. Then the full suite is sent. If it serves real customers, leave it as production.

## Step 6 (optional): check what the agent claims it did

An agent saying "I have refunded your order" has not necessarily refunded anything. If your system has a read-only address that shows an order's or a ticket's state, your developer can enter it under **Connection → Verifying what the agent does**: the **Endpoint**, and an **Auth header** and **Credential** if it needs one. **Check and save** calls it once first; if it does not answer, nothing is stored.

Novera only ever reads from it, never changes anything, and never keeps what it returns. Without it, scenarios that expect an action are reported as unable to verify, never as passed. Only scenarios written to expect an action use it.

## Step 7: run the first test

Press **Run the suite** at the top of the agent's page. The main built-in suite (the EU support agent conformity suite, newest version) is chosen for you; pick another from the list if you prefer. You can also start a test from **Run evaluation** in the top bar, which also offers other languages for some suites. On the trial, each test uses one of three free runs.

## What happens next

The run's page shows the scenarios as they are recorded. Keep it open: in the app, the open page is what moves the test along. If it stops moving, the page says so and offers **Continue run**; nothing recorded is lost. If the agent cannot be reached three times in a row, the run stops, no report is sealed, and the page says why: fix the connection and run again.

When every scenario is recorded, the page shows the grade, the counts and every scenario's evidence, and Novera seals the client report. Open it with **View client report**. To understand it, start with [Reading a report](/docs/reading-a-report); to find your way around the run page, see [Finding your way around Novera](/docs/finding-your-way).

## Changing the connection later

On the agent's **Connection** tab, **Change the connection** lets the owner, an admin or an operator edit any of the fields above, and test before saving. A saved key never moves with the address to another server: if you change the address to a different host, paste the key again. Runs and reports you already have do not change.
