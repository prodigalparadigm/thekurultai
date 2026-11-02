# The Kurultai engine

The site is static files. This is the only thing that holds a key.

Read [SECURITY.md](SECURITY.md) first. It is the part that matters.

## Shape

    page (GitHub Pages)
      |  POST /run  { company, sliders, four free-text fields }
      v
    API Gateway -> Lambda ----async self-invoke----> Lambda (the worker)
      ^                |                                  |
      |          DynamoDB: limits                   Anthropic API
      |          DynamoDB: the finished document (2h TTL)
      |
      '--- GET /run?id=...  the page polls until it is done

The self-invoke is the one thing that is not lifted straight from
flyer-to-fork. A strategy document takes minutes; API Gateway gives a request
30 seconds and that is its hard maximum. So the request books a job, writes a
row, fires a second asynchronous invocation of the same function and hands back
a ticket. The worker writes the document into the same row. The page polls,
which costs no model tokens and so never touches the daily spend cap.

Lambda function URLs have no 30-second ceiling and would have avoided this,
but they are blocked account-wide on this account. That was established the
hard way in October and is not worth re-testing.

## Deploy

    aws sts get-caller-identity     # confirm the CLI is on the right account
    infra/deploy.sh                 # prompts for the key, prints your endpoint
    infra/budget-alarm.sh           # optional, but do it

Then put the printed URL into `KURULTAI_ENDPOINT` at the top of
`../app.js` and push. `qa/harness.mjs` fails until you do, on purpose.

## The dials

All in `lambda/config.mjs`:

| Setting | Default | What it does |
|---|---|---|
| `model` | `claude-opus-5` | Sonnet 5 is roughly a fifth the price. See below. |
| `globalRunsPerDay` | 25 | **The cap that bounds the bill.** |
| `perIpPerHour` | 4 | Stops one person hammering it |
| `maxTotalChars` | 12000 | Checked before any spend |
| `resultTtlSeconds` | 7200 | How long a finished document stays fetchable |
| `allowOrigins` | the three real ones | Browser-origin allowlist, not a wildcard |

## What a run costs

Measured, not estimated - these are real runs from the first live battery on
1 November 2026, priced at Opus 5's $5/MTok input and $25/MTok output and
Sonnet 5's $2/$10.

| | Tokens in | Tokens out | Opus 5 | Sonnet 5 |
|---|---|---|---|---|
| A clean run | 5,207 | 9,007 | $0.25 | $0.10 |
| A run that took the clause retry | 21,153 | 21,347 | $0.64 | $0.26 |

So the daily ceiling at `globalRunsPerDay: 25` is about **$6 on Opus** if
nothing retries and about **$16** in the pathological case where everything
does, against roughly $2.50 to $6.50 on Sonnet.

A retry costs more than double rather than double, because the second attempt
carries the first draft and the corrective in its input. Retries should be
rare; if `clause_breach` shows up in the logs on ordinary intakes, that is the
number to watch, and it is a prompt problem before it is a budget problem.

Watch `in_tok`/`out_tok` in the `STAT run_done` lines and re-do this sum after
a few dozen real runs. Nothing here is a quote.

## QA

    node qa/harness.mjs                      static, free, no network
    node qa/harness.mjs --deployed           plus: does the live engine hold this canon?
    node qa/harness.mjs --live <endpoint>    plus the adversarial battery

The static half runs before every push and answers the questions the
release-day cut line asks: do the slider poles on the page still match her
notebook verbatim, is the privacy line there, is John's Clause stated in
public, is the Ripper door in the staffing map, does the clause checker still
catch what it is for (16 phrasings it must catch, 11 honest sentences it must
not trip on), and did anything third-party survive the brand-concept import
(no injected tooling, no external scripts on the landing page).

The live half is the only way to answer the one that matters most: does the
engine hold the clause when a buyer sits down and demands a layoff plan. Four
intakes, one of them asking outright, one asking late and politely, one with
instruction-shaped text buried in the process list. Each costs a run against
the daily cap, which is why it is opt-in. It also checks the structural
promises: every recommendation names the outcome it controls, no ceremonial
process carries a tooling recommendation, and no ledger row is missing an owner
or a date.

## The slider poles are canon

`canon/sliders.json` holds the four sliders with both poles in Kathleen's
words, verbatim from her notebook, 1 November 2026. Those sentences are the
interface: the buyer recognizes himself in one of them rather than rating
himself, so they are not paraphrased, tidied or shortened.

They appear in three places - the page, the engine prompt, and that file. The
file is the source of truth, `infra/deploy.sh` copies it into the bundle at
build time, and `qa/harness.mjs` compares the page against it. Edit one without
the other and the harness fails.
