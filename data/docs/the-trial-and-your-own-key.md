---
title: The trial, plans, and using your own model key
published: true
---
Each account gets three suite runs free, to evaluate Novera and see a first sealed report. They are counted across every workspace you own, so a second workspace does not start a second trial. There is no card.

Trial runs are graded on Novera's own keys, or on your own model key if you have connected one. Connect a key under **Settings → Grading and data routing**. Novera supports keys from Groq, Google AI Studio, OpenRouter and Anthropic.

After the three trial runs, recurring testing needs a plan, whether or not you have your own key. What a plan pays for is the testing harness, the sealed reports and the CI release gate, not the grading:

- **Team BYOK** grades every run on your own model key, with no run allowance counted.
- **Agency Pro** does the same, and adds 100 runs a month graded on Novera's keys, for workspaces with no key of their own.

A run that is stopped, or replaced by a newer commit in CI, before it records any scenario does not count against your trial runs, a pilot grant or a plan's runs on Novera's keys; it still counts toward the fair-use limit below.

Plans are chosen under **Billing**, by the workspace's owner or an admin. Billing is not open yet. Until it is, a workspace keeps running after its trial on a pilot.

## Pilot access

A pilot gives you a set number of runs for a set time, usually 50 runs over 30 days, without a plan and without a card. A pilot from a code is shared like the trial: its runs cover every workspace you own, including client workspaces you add afterwards, and they are counted together. There are two ways to get one:

- **Ask for a pilot** on the [pilot request page](/apply). Say which agents you would test and for how many client workspaces; a person replies.
- **Enter a pilot code** if Novera sent you one. The workspace's owner or an admin types it under **Settings → Billing**, in *Have a pilot code?*, and presses **Unlock pilot runs**. If you do not have an account yet, create one first; the code is entered after signing up. The runs are available at once in every workspace you own; the page then shows what is left, for example "Pilot · 47 of 50 runs left (shared across your workspaces) · ends 16 November 2026", and the label in the top bar says the same in each of your workspaces.

A code works once, and an account owner redeems one code, in whichever of their workspaces they type it. Capitals and spaces in the code do not matter. If a code is refused, the page says why: the code is not valid, it has already been used, or you already have a pilot, which covers every workspace you own. After a few wrong attempts the page asks you to wait a few minutes before trying again. For more runs once a pilot is used, ask us through [Support](/support).

A pilot's runs are counted like any other: a run that is stopped before it records any scenario does not count, and the fair-use limit below still applies to each workspace. A run in a client workspace names the pilot it used, and its report says it was graded by Novera under a grant to the workspace's owner. The pilot belongs to the workspace you redeemed the code in: erasing that workspace ends the pilot for all of your workspaces, and the erase page says so before you confirm. Runs under a pilot are graded on your own model key if the workspace has one, and on Novera's keys otherwise. When the pilot ends or its runs are used, every run and report stays readable and exportable.

Every plan has a fair-use limit, so a runaway pipeline cannot start thousands of runs: at most three runs in progress at once in a workspace, and at most 1,000 runs in any 30 days. Support can raise it for a workspace that needs more. Over the API, a run refused for fair use is answered with status 429, so a pipeline can back off and try again.

A key is tested with one short request before it is stored. If it does not work, it is not saved.

A workspace with its own key is graded on that key alone. Novera does not fall back to its own key when yours is rate-limited, because every report states who funded the grading, and that statement has to stay true. If your provider limits a run, those scenarios are reported as having produced no result. A report graded on Novera's keys under a plan says so, rather than calling it the trial.

Removing your key puts the workspace back on Novera's keys. Those are the trial's remaining runs, or Agency Pro's monthly runs. Team BYOK includes no runs on Novera's keys.

Whatever happens to a plan, every run, case and report stays readable and exportable.
