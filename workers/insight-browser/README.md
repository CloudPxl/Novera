# novera-insight-worker

Novera's browser worker for public-demo insight scans. It claims a queued scan from a Novera
deployment, opens the target's public page in headless Chromium, finds the chat widget, types each
of the scan's prompts exactly, waits for the reply to stop changing, and reports what the widget
displayed. The server redacts, grades and stores; the worker holds no model key and no database
credential, only one secret that opens two routes.

## What it never does

- open a page that robots.txt closes to `NoveraInsightBot` or to every crawler (the server checks
  too, before handing the scan over);
- attempt a bot challenge, captcha or Turnstile — the scan ends as `blocked_challenge`;
- type anything when the widget shows a password or card field, or asks the visitor to log in or
  pay — the scan ends as `blocked_login` / `blocked_payment`, before or after a reply;
- follow the page to another site (`redirected_offsite`);
- send a prompt twice, run two sessions at once, or send prompts closer than the server allows
  (12 s, more when robots.txt asks for a crawl delay);
- create an account, sign in, buy, book, cancel, or fill in anything but the chat box; on a cookie
  banner it presses the plain acceptance button once;
- log a reply's text: logs name scan ids, scenario ids, outcomes and timings.

Each scenario runs in a fresh browser context, so no reply carries the conversation before it.

## Install

```sh
cd workers/insight-browser
npm ci
npx playwright install --with-deps chromium   # on a server; on a Mac with Chrome, set the channel instead
cd ../.. && npm run insight-worker:build        # writes workers/insight-browser/dist/worker.mjs
```

## Configure

| Variable | Value |
|---|---|
| `NOVERA_BASE_URL` | the deployment, e.g. `https://www.nover.space` |
| `NOVERA_INSIGHT_WORKER_SECRET` | from `npm run insight-worker:secret`, run with the **deployment's** `NOVERA_ENCRYPTION_KEY` |
| `NOVERA_INSIGHT_WORKER_ID` | this worker's name: lowercase letters, digits, dots, dashes (`vps-1`) |
| `NOVERA_INSIGHT_WORKER_CHANNEL` | optional: `chrome` to use an installed Google Chrome |

## Run

```sh
node workers/insight-browser/dist/worker.mjs --once   # one scan if one is queued (exit 0 graded or idle, 1 error, 2 stopped, 3 config, 4 server)
node workers/insight-browser/dist/worker.mjs --loop   # one scan at a time; checks every 30 s when idle
```

On a server, under systemd:

```ini
[Unit]
Description=Novera insight browser worker
After=network-online.target

[Service]
WorkingDirectory=/opt/novera
EnvironmentFile=/etc/novera/insight-worker.env
ExecStart=/usr/bin/node workers/insight-browser/dist/worker.mjs --loop
Restart=on-failure
RestartSec=30
User=novera

[Install]
WantedBy=multi-user.target
```

`SIGTERM` finishes the current step and ends the scan as `worker_error` ("stopped"); a second
signal exits at once. A worker that stops reporting for five minutes past its lease has its scan
ended as `lease_expired` by the next claim, never as a verdict.

## Verify

`npm run verify:insight-browser` in the repository runs this worker against Novera's scripted chat
widget with the real server handlers and an in-memory store: about four minutes, nothing leaves the
machine, no model is called.
