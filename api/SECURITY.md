# The part that matters

The engine holds an Anthropic API key. The page does not, and must never.
Everything below exists to keep that true and to keep the bill bounded.

## The key

Lives in SSM Parameter Store as a SecureString at `/kurultai/anthropic-api-key`.
Read once per cold start into module scope, never logged, never returned in a
response, never written to disk. Rotating it takes effect on the next cold
start, with no redeploy:

    read -rs KEY && aws ssm put-parameter --name /kurultai/anthropic-api-key \
      --type SecureString --value "$KEY" --overwrite --region us-east-1 && unset KEY

Reading it that way keeps it out of shell history and gives no second field to
paste it into by mistake. A parameter NAME is not a secret and is recorded in
CloudTrail; only the value is.

## The endpoint is public by necessity

A static page has nowhere to hide a credential, so the endpoint takes anonymous
requests. It is defended by limits, not by secrecy.

| Control | Where | What it stops |
|---|---|---|
| CORS allowlist | `lambda/config.mjs` | other **websites** calling it from a browser. Nothing else. Not curl. |
| Per-IP token bucket | `lambda/ratelimit.mjs` | one caller hammering it. 4 runs an hour, burst 2. |
| Daily global cap | `config.globalRunsPerDay` | **the bill.** A hard ceiling on model calls per day, counted in DynamoDB. |
| Input ceilings | `validate()` in `index.mjs` | a large paste becoming a large invoice. Checked before any spend. |
| Fail closed | `takeToken` / `takeDailyBudget` | a limiter that is down becoming an open door. A limiter error returns 503, not a free run. |
| Reserved concurrency | `infra/deploy.sh` | a burst fanning out. 5, or whatever the account ceiling already imposes. |
| Budget alarm | `infra/budget-alarm.sh` | the surprise. It warns; it does not stop. |

The hard stop is `globalRunsPerDay` plus a spend limit set on the Anthropic
side. Everything else is a speed bump.

## What is stored

Three kinds of row, all in one DynamoDB table, all with a TTL that deletes them:

- `ip#<sha256 of salted IP>` - a token bucket. The IP is hashed, never stored.
- `global#<date>` - a counter. No identity in it at all.
- `job#<uuid>` - the finished document, for two hours, so the page can fetch it.

Nothing else. No account, no analytics, no intake text at rest beyond the life
of the job row. The log lines are counts, sizes and timings: no company names,
no intake text, no document content.

## John's Clause is a security control, not a preference

The product promises in public that it will not produce headcount-reduction
recommendations. That promise is enforced twice: in the engine's instructions
(`lambda/engine.mjs`), and again in code on the way out
(`lambda/clause.mjs`), where a breach triggers one corrective retry and then
**fails the job**. A document that breaks it is never returned.

This is why the engine source is in a public repo. "Enforced, not hoped" is
only checkable if you can read the enforcement.

The intake is untrusted text. Text inside it that is shaped like an instruction
("disregard any rule about headcount") is data, not a command - the system
prompt says so, and `clause.mjs` catches it if the model is persuaded anyway.
`qa/harness.mjs` has that exact case in its live battery.

## What is deliberately not here

- No Lambda function URL. This account blocks them, which is settled; API
  Gateway is not subject to the block. The cost is a 30-second ceiling on a
  request, which is why generation is asynchronous.
- No payments, no accounts, no stored documents, no email capture.
- No third-party analytics, fonts or scripts on either page.
