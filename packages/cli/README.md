# novera

The command line for [Novera](https://www.nover.space): verify a sealed report, gate a CI
job on it, export it, and start a run with a workspace API key.

```
npx novera-cli report status https://www.nover.space/report/<token>
```

| Command | What it does |
|---|---|
| `novera report verify <link \| token \| export.json>` | Recomputes the report's SHA-256 and says whether it matches the hash it was sealed with |
| `novera report status <link \| token \| export.json> [--junit file]` | Exits with the report's CI code, hash verified |
| `novera report export <link \| token> --format md\|csv\|json\|junit [--out file]` | Downloads the report in that format |
| `novera suite validate <suite.json \| suite.csv>` | Checks a suite file with the same validator the app uses |
| `novera run --agent <id> [--suite <id>] [--junit file]` | Starts a run with `NOVERA_API_KEY` (a key with the run scope), drives it to the end, exits with its code |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | complete, and every scenario passed |
| 1 | a scenario failed |
| 2 | evidence incomplete, or the report could not be verified — never a pass |
| 3 | configuration or authorisation |
| 4 | infrastructure: network or server |

Keep the key in an environment variable or your CI's secret store, never in a command's
arguments. Nothing this tool does publishes, revokes or approves anything.

Novera is evidence of testing, not a legal certification. Full documentation:
https://www.nover.space/docs/cli-and-ci
