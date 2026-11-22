import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CONFIG } from "./config.mjs";
import { lookerFor, lookKeys, utcDay } from "./look.mjs";

/* The LOOKS counter's writes. Separated from look.mjs because this half
   imports the AWS SDK, which the Lambda runtime provides and node_modules
   does not - keeping them apart is what lets the harness test the key and
   hash logic without an AWS account. */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DAY = 86400;

/* Three items, all keyed deterministically so reading them back later needs
   GetItem and never a Scan:

     look#<site>#<path>#<day>   views + the day's looker set, per page
     lookday#<site>#<day>       views + the day's looker set, per site
     lookmonth#<site>#<YYYY-MM> views only, and NO TTL

   The per-site row is not derivable from the per-page rows: one person
   reading three pages is three page-looks but one distinct looker, and that
   is only knowable if the site keeps its own set.

   The month row exists because the daily rows expire at 90 days and the
   quotable history should not. It carries views on the hot path; its
   max-daily-distinct high-water mark is maintained by qa/traffic.mjs when it
   runs, because a maximum cannot be computed by an atomic increment. The
   consequence is stated where the number is printed: a day that expired
   without traffic.mjs ever reading it contributes its views to the month and
   not its distinct count.

   The looker set is capped. A set is one DynamoDB item and an item is capped
   at 400KB, so an unbounded set is an outage waiting for a busy day. At the
   cap the row keeps counting views and stops adding lookers, and flags
   itself so the report can say "distinct is a floor here" instead of quietly
   understating. */
async function bump(pk, { looker, ttl }) {
  const ex = { ":one": 1, ":e": ttl };
  let expr = ttl ? "SET expires = :e ADD v :one" : "ADD v :one";
  if (!ttl) delete ex[":e"];
  if (looker) { expr += ", d :d"; ex[":d"] = new Set([looker]); }

  try {
    await ddb.send(new UpdateCommand({
      TableName: CONFIG.tableName,
      Key: { pk },
      UpdateExpression: expr,
      /* size() on a set is evaluated server-side, so the cap costs no read. */
      ...(looker ? {
        ConditionExpression: "attribute_not_exists(d) OR size(d) < :cap",
        ExpressionAttributeValues: { ...ex, ":cap": CONFIG.lookDistinctCap },
      } : { ExpressionAttributeValues: ex }),
    }));
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
    /* The set is full. Count the view, mark the row, keep the promise: the
       alternative is losing the look entirely or growing the item until a
       write fails outright. */
    await ddb.send(new UpdateCommand({
      TableName: CONFIG.tableName,
      Key: { pk },
      UpdateExpression: (ttl ? "SET expires = :e, capped = :t ADD v :one" : "SET capped = :t ADD v :one"),
      ExpressionAttributeValues: ttl ? { ":one": 1, ":e": ttl, ":t": true } : { ":one": 1, ":t": true },
    }));
  }
}

export async function recordLook({ site, path, ip, when = new Date() }) {
  const looker = lookerFor(ip, utcDay(when));
  const ttl = Math.floor(when.getTime() / 1000) + CONFIG.lookTtlDays * DAY;
  /* The keys come from look.mjs, which is also what the harness and
     traffic.mjs read with. One builder, so a writer and a reader cannot
     disagree about where a number lives. */
  const k = lookKeys(site, path, when);

  /* In parallel: the beacon is fire-and-forget, but the function still pays
     for the time it waits, and nothing here depends on anything else here. */
  await Promise.all([
    bump(k.page, { looker, ttl }),
    bump(k.day, { looker, ttl }),
    bump(k.month, { ttl: 0 }),
  ]);
}
