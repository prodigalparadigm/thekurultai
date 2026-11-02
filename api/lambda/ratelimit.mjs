import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomUUID } from "node:crypto";
import { CONFIG } from "./config.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const HOUR = 3600, DAY = 86400;

// Visitor IPs are hashed, never stored.
/* The salt has to be SECRET as well as stable: this file is in a public repo,
   and with a known salt every IPv4 address can be precomputed, which turns
   the hash back into the thing it was meant to hide. It is set at deploy time
   from SSM. The fallback is deliberately random per cold start - that costs a
   little limiter accuracy across restarts and never silently reinstates a
   published salt. */
const SALT = process.env.IP_SALT || ("ephemeral-" + randomUUID());
const idFor = (ip) => createHash("sha256").update(SALT + "|" + ip).digest("hex").slice(0, 32);
const today = () => new Date().toISOString().slice(0, 10);

/* A token bucket that refills continuously, written as one conditional update
   so two simultaneous requests cannot both spend the last token. */
export async function takeToken(ip, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const perHour = opts.perHour ?? CONFIG.perIpPerHour;
  const rate = perHour / HOUR;                    // tokens per second
  const cap = opts.burst ?? CONFIG.perIpBurst;

  const key = { pk: (opts.prefix || "ip") + "#" + idFor(ip) };
  const cur = await ddb.send(new GetCommand({ TableName: CONFIG.tableName, Key: key }));
  const prev = cur.Item ?? { tokens: cap, ts: now };
  const refilled = Math.min(cap, prev.tokens + (now - prev.ts) * rate);

  if (refilled < 1) {
    const waitSec = Math.ceil((1 - refilled) / rate);
    return { ok: false, retryAfter: waitSec };
  }
  try {
    await ddb.send(new UpdateCommand({
      TableName: CONFIG.tableName,
      Key: key,
      UpdateExpression: "SET tokens = :t, ts = :n, expires = :e",
      // only write if nobody else moved the bucket since we read it
      ConditionExpression: "attribute_not_exists(ts) OR ts = :prev",
      ExpressionAttributeValues: {
        ":t": refilled - 1, ":n": now, ":prev": prev.ts, ":e": now + 2 * DAY,
      },
    }));
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return { ok: false, retryAfter: 2 };
    throw e;
  }
  return { ok: true };
}

/* The hard ceiling. Atomic increment, then compare: a race can overshoot by
   the number of in-flight requests, never by more. */
export async function takeDailyBudget() {
  const now = Math.floor(Date.now() / 1000);
  const res = await ddb.send(new UpdateCommand({
    TableName: CONFIG.tableName,
    Key: { pk: "global#" + today() },
    // Two traps here: SET must precede ADD, and "reads" is a DynamoDB
    // reserved keyword, so it has to go through an expression attribute name.
    UpdateExpression: "SET expires = :e ADD #r :one",
    ExpressionAttributeNames: { "#r": "reads" },
    ExpressionAttributeValues: { ":one": 1, ":e": now + 3 * DAY },
    ReturnValues: "UPDATED_NEW",
  }));
  const used = Number(res.Attributes?.reads ?? 0);
  return { ok: used <= CONFIG.globalRunsPerDay, used, cap: CONFIG.globalRunsPerDay };
}
