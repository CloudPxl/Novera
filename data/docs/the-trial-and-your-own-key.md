---
title: The trial, and using your own model key
published: true
---
Each account gets three suite runs, graded on Novera's own free-tier key. They are counted across every workspace you own, so a second workspace does not start a second trial. There is no card and nothing to pay.

After three runs, connect your own model key under **Settings → Grading and data routing** and the cap is removed. Novera supports keys from Groq, Google AI Studio, OpenRouter and Anthropic. There is still nothing to pay Novera — the grading simply runs on your key, on your provider's free or paid tier, inside your own account.

A key is tested with one short request before it is stored. If it does not work, it is not saved.

A workspace with its own key is graded on that key alone. Novera does not fall back to its own key when yours is rate-limited, because every report states who funded the grading and that statement has to stay true. If your provider limits a run, those scenarios are reported as having produced no result.

Removing your key puts the workspace back on the capped trial allowance.
