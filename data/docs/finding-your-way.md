---
title: Finding your way around Novera
published: true
---
This page walks through Novera's screens once you have signed in: what each place is for, what you do there, and where to find the report you hand to a client. For what each part does and why, see [Novera in plain words](/docs/novera-in-plain-words).

## The order of the work

Novera's navigation follows the order the work happens in: **connect** an agent, **run** a test, **share** the sealed report. The top bar holds five places, in that order:

- **Dashboard**: where things stand, and the one thing to do next.
- **Agents**: the AI agents you test.
- **Scenarios**: what the agents are tested on.
- **Runs**: every test, what it found, and the reports.
- **Settings**: your profile, the workspace, its members, keys and billing.

On a phone or a narrow window, these are inside the **menu** button at the right of the top bar.

## How you use Novera changes the labels

When you sign up you say how you will use Novera, and you can change it later under **Settings → Profile and preferences**. Nothing you have moves when you change it.

- **Personal**: for testing your own agent. Agents and Runs are called **My agent** (or **My agents**) and **My runs**.
- **Agency**: for testing agents you deliver to clients. Each client gets a **workspace** of their own, so their agents, keys and reports stay apart, and each report names that client. A switcher next to the logo, headed **Clients**, moves between them; the dashboard lists your clients.
- **Enterprise**: for several teams. The top bar adds **Workspaces** and, for those allowed to see it, **Audit**.

## The top bar

From left to right:

- The **Novera logo** goes back to the home page.
- The **workspace switcher**, when you belong to more than one workspace or use agency or enterprise mode.
- The five places above.
- A short label saying **who pays for grading** in this workspace: Novera's trial (with runs left), a plan, or your own model key. The owner and admins can open billing from it.
- Your **role**, if you are not the owner.
- **Run evaluation** (shortened to **Run** on smaller screens): start a test from any page. Choose the agent, the suite and, where the suite offers it, the language.
- The **menu**: your name and role, **Connect an agent**, **Members**, **Billing**, **Your profile**, the **Step-by-step guide**, **Novera in plain words**, the **Documentation**, and **Sign out**. What appears depends on your role.

At the bottom right of every signed-in page is **Ask Novera**, an assistant that answers questions about Novera from this documentation and about your own runs from their stored counts. It cannot change anything. See [The Ask Novera assistant](/docs/ask-novera).

## Dashboard

Before your first test, the dashboard shows the **getting-started steps**: connect your agent, write its policy, run the suite. Each step ticks itself only when it has actually happened. If you have no agent address to hand, **Or try a sample support agent first** adds Novera's own test agent.

Afterwards, it shows one sentence about the state of the workspace, three figures (the latest run, open findings, reports ready to share), **Needs attention** (at most five things that need someone, each with a link to where it is resolved), and your recent runs. The button at the top right is always the most useful next step for your role.

## Agents

The list of agents in the workspace. **Connect an agent** adds one: see [Connecting your agent, step by step](/docs/connect-step-by-step). Open an agent to find its tabs:

- **Overview**: its recent results.
- **Policy**: the rules the agent should keep. Saving creates a new version; old versions are kept.
- **Runs**: every test of this agent.
- **Schedule**: run a suite automatically every day or week. See [Scheduled runs](/docs/scheduled-runs).
- **Connection**: the receipt of the last connection check, **Change the connection**, **Production or test target**, **Verifying what the agent does** (the optional read-back), **Gate pull requests in CI**, and archiving.

The **Run the suite** button at the top of an agent's page starts a test. If the agent has no policy yet, the button is **Write the policy** instead. Under **What are you testing? (optional)** you can note the agent release and knowledge-base version; the report shows them as declared by you.

## Scenarios

The tabs at the top:

- **Library**: the suites your workspace can run, and their scenarios.
- **Catalog**: every built-in suite and every version of it, with what changed between versions. From here you can also try one scenario alone against one of your agents.
- **Drafts**: scenarios waiting for a person to approve or reject them, and approved ones waiting to be added to a suite. This is also where you can run up to five approved scenarios beside an official suite (**Extend an official suite**).
- **Draft or import**: draft scenarios from your policy, or import them from a file or another testing tool. See [Writing and importing a suite](/docs/writing-a-suite).
- **Builder**: the Suite Builder. See [The Suite Builder](/docs/suite-builder).
- **Regressions**: turn a mistake your agent made with a real customer into a scenario. See [Regressions from production](/docs/regressions-from-production).

## Runs

The tabs at the top:

- **All runs**: every test, filtered by **Failed**, **Evidence incomplete**, **Passed** or **In progress**.
- **Review**: what needs a person across the last ten finished runs, grouped as **Needs attention**, **Evidence incomplete**, **New regressions**, **Unverified actions**, **Awaiting approval** and **Closed**.
- **Reports**: every sealed report, with whether it is ready to share.
- **Compare**: choose two runs and see them side by side.

## A run's own page

While a run is in progress, its page shows each scenario as it is recorded. The result appears only when every scenario is recorded, never before. Keep the page open: in the app, the open page is what moves the run along.

If a run has not moved for a few minutes, the page says so: "This run has not moved for 4 minutes. Nothing is lost: every scenario recorded so far is kept." Press **Continue run** to carry on. If another process is already advancing it, the page says that instead and the run continues on its own. A run that records nothing for 24 hours is stopped, and no report is sealed for it.

When the run is finished, the page shows:

- **The scorecard**: the grade, the counts and how the verdicts were reached.
- **The client report bar**, when a report was sealed: its readiness (**Ready to share**, **Review before sharing**, **Incomplete**, **Grade withheld**, and so on), **View client report**, a button to copy the link, **Print / save PDF**, **Verify seal**, **Compare with previous run** when there is one, and **Downloads** (Markdown, CSV, JSON, JUnit). A run against Novera's test agent is labelled test data here too.
- **How to read this run (60-second guide)**: a closed box with the same plain explanation the client report carries.
- **Rerun and compare against this**: start the same test again, compared with this one.
- Five tabs: **Overview** (what to look at first), **Cases** (every scenario, filtered by **Failed**, **No result** or **Passed**; open one for its full evidence), **Comparison** (against an earlier run of the same suite), **Evidence** (the seal, the inputs recorded before the run, **Before you send it** and **Withdraw this report**) and **Activity** (what happened to this run, and when).

On a failed scenario, **Why did this fail?** asks for a proposed change to your policy, and **Try this scenario alone** sends that one scenario again. On any scenario you can record your own finding beside the verdict. See [How a run works](/docs/how-a-run-works).

## Sharing, printing and checking a report

- **To share**: on the run's page, copy the link from the client report bar. The link is private, expires after 30 days, and can be withdrawn from the **Evidence** tab.
- **To print or make a PDF**: **Print / save PDF** opens the client report and your browser's print window; choose "Save as PDF" there. The printed report keeps its seal and a short reading legend on the first page.
- **To check the seal**: **Verify seal** opens the public seal check. Anyone else can use [the seal check](/verify) too, by pasting the fingerprint or dropping the JSON download.
- **To compare**: **Compare with previous run**, or **Runs → Compare**.

For how a client reads it, see [Reading a report](/docs/reading-a-report).

## Settings

On the left (at the top on a phone), grouped by whom they concern:

- **You**: **Profile and preferences** (how you use Novera, your preferences, what Ask Novera remembers, and downloading your own data or deleting your account) and **Sign-in and security** (password, sign-in methods, signing out everywhere).
- **This workspace**: **General** (its name, exporting the whole workspace, how long the agent's raw replies are kept, and erasing or leaving the workspace), **Grading and data routing** (which models grade your runs, connecting your own model key, and what kind of data each grading provider may receive), **Members** (invite people and set roles; shown once there is more than one member, or in agency and enterprise mode) and **Billing**.
- **Developer**: **API keys, MCP and webhooks**.
- **Security**: **Audit log**, for the owner, admins and auditors.

## The `?` explanations

A small `?` next to a word or a figure opens a short explanation in place: what it is, why it matters, and what to do next, often with a link to the page of the documentation that says more. It opens with a click or the keyboard and needs nothing else. The `?` marks are left out when a page is printed. For every word in one place, see the [plain-words glossary](/docs/plain-glossary).
