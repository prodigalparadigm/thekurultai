import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomUUID } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CONFIG } from "./config.mjs";
import { takeToken, takeDailyBudget } from "./ratelimit.mjs";
import { Doc, SYSTEM, userPrompt, clauseFindings, CLAUSE_RETRY } from "./engine.mjs";
import { safeDetail } from "./safelog.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

/* ---------- the key ----------
   Read once per cold start from SSM, held in module scope, never logged,
   never returned. Rotating the parameter takes effect on the next cold start. */
let keyPromise = null;
function apiKey() {
  if (!keyPromise) {
    const ssm = new SSMClient({});
    keyPromise = ssm
      .send(new GetParameterCommand({ Name: CONFIG.ssmKeyParam, WithDecryption: true }))
      .then((r) => r.Parameter.Value)
      .catch((e) => { keyPromise = null; throw e; });   // don't cache a failure
  }
  return keyPromise;
}

/* Echo the caller's Origin when it is one of ours. This stops other WEBSITES
   using the endpoint from a browser. It does nothing against curl. The limits
   do that. */
function corsFor(event) {
  const h = event?.headers || {};
  const origin = h.origin || h.Origin || "";
  const ok = CONFIG.allowOrigins.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : CONFIG.allowOrigins[0],
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-max-age": "3600",
    /* Without this the browser hides Retry-After from the page, so the
       "about N minutes" message added earlier tonight could never fire and
       every rate-limited visitor was told "shortly". */
    "access-control-expose-headers": "retry-after",
    vary: "Origin",
  };
}
const json = (status, body, extra = {}, event = null) => ({
  statusCode: status,
  headers: { "content-type": "application/json", ...corsFor(event), ...extra },
  body: JSON.stringify(body),
});

const now = () => Math.floor(Date.now() / 1000);

/* ---------- intake validation ----------
   Everything the page can send, checked before a cent is spent. Free text is
   capped per field and in total; sliders must be numbers in range. */
const TEXT_FIELDS = ["processes", "current_ai", "staffing", "outcome_90"];
const SLIDER_IDS = ["staffing", "data_governance", "risk_tolerance", "upfront_investment"];

function validate(payload) {
  const c = payload?.company || {};
  const intake = {
    company: {
      name: String(c.name || "").slice(0, 120).trim(),
      industry: String(c.industry || "").slice(0, 160).trim(),  // the page sends "<type> - <industry>"
      size: String(c.size || "").slice(0, 60).trim(),
      regulated: Boolean(c.regulated),
    },
    sliders: {},
  };

  let total = 0;
  for (const f of TEXT_FIELDS) {
    const v = String(payload?.[f] ?? "").trim();
    if (v.length > CONFIG.maxFieldChars)
      return { error: "field_too_long", message: `Keep "${f}" under ${CONFIG.maxFieldChars} characters.` };
    total += v.length;
    intake[f] = v;
  }
  if (total > CONFIG.maxTotalChars)
    return { error: "payload_too_long", message: "That is more than the sketch tier reads. Trim it, or ask for the full document." };
  if (!intake.processes)
    return { error: "no_processes", message: "The ceremony audit needs the processes, in your own words." };

  for (const id of SLIDER_IDS) {
    const n = Number(payload?.sliders?.[id]);
    if (!Number.isFinite(n) || n < 0 || n > 100)
      return { error: "bad_slider", message: `Slider "${id}" must be a number from 0 to 100.` };
    intake.sliders[id] = Math.round(n);
  }
  /* Returned BESIDE the intake, never inside it. The engine's behaviour must
     not depend on this - John's Clause, the rails and the prompt are byte
     for byte the same for a demonstration run - it exists only so the
     finished record can say what the document was built from. Keeping it out
     of `intake` means a future change that serializes the intake into a
     prompt cannot accidentally tell the model it is being demonstrated. */
  return { intake, demo: payload?.demo === true };
}

/* ---------- the generation itself ----------
   Runs in the worker invocation, not in the request, because a document takes
   minutes and API Gateway gives a request 30 seconds. */
/* `stage` exists because the page used to invent one. It ran five sentences
   on a timer - "Sorting your processes...", "Writing the ninety days..." -
   describing an order of work that does not happen: the document is ONE
   model call returning one structured object, so there is no instant at
   which the engine is provably doing the ceremony audit and not the staffing
   map. Three boundaries are real, and these are they. If someone later splits
   the call per engine, that is when more stages become truthful. */
async function generate(intake, note, stage = () => {}) {
  const key = await apiKey();
  const ws = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey: key,
    ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}),
  });

  const messages = [{ role: "user", content: userPrompt(intake) }];
  let usage = { input: 0, output: 0 };
  let retried = false;

  /* messages.parse() throws on a truncated body before stop_reason can be
     read, so the shape of that error is classified here rather than landing
     in the catch-all as "Error". A caller who sees "too_long" is being told
     something true; a caller who saw "Error" was being told nothing. */
  const classify = (e) => {
    const m = String(e?.message ?? "");
    if (/Unterminated string|Failed to parse structured output|Unexpected end of JSON/i.test(m))
      return "too_long";
    if (e?.status) return "api_" + e.status;
    return e?.kind || e?.name || "error";
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    await stage(attempt === 0 ? "writing" : "rewriting");
    /* Streamed, not awaited whole. At max_tokens this size the SDK refuses a
       non-streaming request outright - "Streaming is required for operations
       that may take longer than 10 minutes" - and that refusal is what the
       first fix for the truncation bug ran into. finalMessage() still returns
       a ParsedMessage carrying parsed_output, so structured outputs are
       unaffected; only the transport changes. */
    let res;
    try {
      const stream = client.messages.stream({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        system: SYSTEM,
        messages,
        output_config: {
          format: zodOutputFormat(Doc),
          ...(/haiku/i.test(CONFIG.model) ? {} : { effort: "high" }),
        },
      });
      res = await stream.finalMessage();
    } catch (e) {
      throw Object.assign(e, { kind: classify(e) });
    }
    usage = {
      input: usage.input + (res.usage?.input_tokens ?? 0),
      output: usage.output + (res.usage?.output_tokens ?? 0),
    };
    if (res.stop_reason === "max_tokens")
      throw Object.assign(new Error("truncated"), { kind: "too_long", usage });
    if (res.stop_reason === "refusal") throw Object.assign(new Error("refused"), { kind: "refused" });
    if (!res.parsed_output) throw Object.assign(new Error("unparsed"), { kind: "unparsed" });

    /* John's Clause, second line: the instructions are the first. */
    await stage("checking");
    const intakeText = [intake.processes, intake.current_ai, intake.staffing,
                        intake.outcome_90, intake.company?.name, intake.company?.industry]
                        .filter(Boolean).join(" \n ");
    const findings = clauseFindings(res.parsed_output, "", intakeText, intake.company?.name || "");
    if (!findings.length) return { doc: res.parsed_output, usage, retried };

    note("clause_breach", { attempt, hits: findings.length, fields: findings.map((f) => f.field).slice(0, 6) });
    if (attempt === 1) {
      /* Twice is not a slip. Fail closed: a document that recommends cutting
         people is worse than no document, and this product says so in public. */
      throw Object.assign(new Error("clause"), { kind: "clause", findings });
    }
    retried = true;
    messages.push({ role: "assistant", content: JSON.stringify(res.parsed_output) });
    messages.push({
      role: "user",
      content: CLAUSE_RETRY.replace(
        "%FINDINGS%",
        findings.map((f) => `- ${f.field}: "${f.text}"`).join("\n")
      ),
    });
  }
  throw Object.assign(new Error("clause"), { kind: "clause", findings: [] });
}

export async function handler(event) {
  const started = Date.now();
  /* One line per request so tomorrow is evidence rather than guesswork.
     Counts, sizes and timings only: no company names, no intake text, no
     document content. Nothing here identifies a buyer or their business. */
  const note = (what, extra = {}) =>
    console.log("STAT " + JSON.stringify({ what, ms: Date.now() - started, ...extra }));

  /* ---- the worker invocation ----
     Not an HTTP request. Comes from this function invoking itself with
     InvocationType Event, so it is free to take minutes. */
  if (event?.kurultaiJob) {
    const { id, intake, demo } = event.kurultaiJob;
    /* Best effort by design. A stage write that fails must never cost the
       visitor the document it is only narrating, so this swallows its own
       errors and the run carries on. */
    const stage = async (name) => {
      try {
        await ddb.send(new UpdateCommand({
          TableName: CONFIG.tableName,
          Key: { pk: "job#" + id },
          // "stage" is a DynamoDB reserved word, so it is aliased like status and usage.
          UpdateExpression: "SET #g = :g",
          ExpressionAttributeNames: { "#g": "stage" },
          ExpressionAttributeValues: { ":g": name },
        }));
      } catch { /* the document matters; the label does not */ }
    };
    try {
      const { doc, usage, retried } = await generate(intake, note, stage);
      await ddb.send(new UpdateCommand({
        TableName: CONFIG.tableName,
        Key: { pk: "job#" + id },
        // "status" and "usage" are both DynamoDB reserved words.
        UpdateExpression: "SET #s = :s, doc = :d, finished = :f, #u = :u, #m = :m",
        ExpressionAttributeNames: { "#s": "status", "#u": "usage", "#m": "demo" },
        ExpressionAttributeValues: { ":s": "done", ":d": JSON.stringify(doc), ":f": now(), ":u": usage, ":m": demo === true },
      }));
      note("run_done", { ...usage, retried, rows: doc.ceremony_audit?.rows?.length ?? 0 });
    } catch (e) {
      const kind = e?.kind || e?.name || "error";
      /* The shape of the failure, never the content. An API 400 describes the
         field it rejected, and without that a bad request is unguessable - so
         the shape is still logged, but it is recognised in the message by
         safeDetail() rather than copied out of it. This line used to carry
         600 characters of e.message, which is the one path by which a
         fragment of a buyer's intake could reach a log that outlives the two
         hours the page promises. See safelog.mjs. */
      console.error("run_failed", kind, JSON.stringify(safeDetail(e)));
      note("run_failed", { kind });
      await ddb.send(new UpdateCommand({
        TableName: CONFIG.tableName,
        Key: { pk: "job#" + id },
        UpdateExpression: "SET #s = :s, reason = :r, finished = :f",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "failed", ":r": kind, ":f": now() },
      }));
      /* The daily slot was spent before generation started. A run that failed
         for our reason should not cost the next visitor their turn, so give
         it back. Deliberately not refunded for a clause failure: that one
         consumed the model twice and is a real cost. */
      if (kind !== "clause") {
        try {
          await ddb.send(new UpdateCommand({
            TableName: CONFIG.tableName,
            Key: { pk: "global#" + new Date().toISOString().slice(0, 10) },
            UpdateExpression: "ADD #r :minus",
            ExpressionAttributeNames: { "#r": "reads" },
            ExpressionAttributeValues: { ":minus": -1 },
          }));
          note("slot_refunded", { kind });
        } catch (refundErr) {
          console.error("refund_failed", refundErr?.name);
        }
      }
    }
    return { ok: true };
  }

  const J = (st, b, ex = {}) => json(st, b, ex, event);
  const method = event?.requestContext?.http?.method ?? "POST";
  const path = event?.rawPath || event?.requestContext?.http?.path || "";
  const ip = event?.requestContext?.http?.sourceIp || "unknown";
  if (method === "OPTIONS") return J(204, {});

  /* ---- polling: no model call, so it never touches the daily spend cap ----
     It still gets a bucket, because an open proxy is rude even when it is free. */
  if (path.endsWith("/run") && method === "GET") {
    try {
      const b = await takeToken(ip, {
        prefix: "poll", perHour: CONFIG.pollPerIpPerHour, burst: CONFIG.pollPerIpBurst,
      });
      if (!b.ok) return J(429, { error: "rate_limited", message: "Slow down a moment." },
        { "retry-after": String(b.retryAfter) });
    } catch (e) {
      console.error("limiter_unavailable", e?.name);
      return J(503, { error: "unavailable", message: "Temporarily unavailable." });
    }
    const id = String(event?.queryStringParameters?.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return J(400, { error: "bad_id", message: "Bad job id." });
    const r = await ddb.send(new GetCommand({ TableName: CONFIG.tableName, Key: { pk: "job#" + id } }));
    if (!r.Item) return J(404, { error: "no_job", message: "That document has expired. Run it again." });
    /* The page promises the document deletes itself within two hours. The TTL
       row carries that, but DynamoDB removes expired items on its own
       schedule - days, sometimes - so without this check the promise was
       true of the intent and false of the behaviour. */
    if (Number(r.Item.expires) && Number(r.Item.expires) < now())
      return J(404, { error: "expired", message: "That document has expired. Run it again." });
    if (r.Item.status === "done")
      return J(200, { status: "done", document: JSON.parse(r.Item.doc), demo: r.Item.demo === true });
    if (r.Item.status === "failed")
      return J(200, { status: "failed", reason: r.Item.reason || "error" });
    /* Only what the worker wrote. No stage is sent until one is true. */
    return J(200, { status: "running", since: r.Item.created,
                    ...(r.Item.stage ? { stage: r.Item.stage } : {}) });
  }

  if (!path.endsWith("/run")) return J(404, { error: "not_found" });
  if (method !== "POST") return J(405, { error: "method_not_allowed" });

  // ---- 1. validate before spending anything ----
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    payload = JSON.parse(raw || "{}");
  } catch {
    return J(400, { error: "bad_json", message: "Body must be JSON." });
  }
  const v = validate(payload);
  if (v.error) return J(400, v);

  // ---- 2. per-caller limit, then the daily ceiling ----
  try {
    const bucket = await takeToken(ip);
    if (!bucket.ok) {
      note("run_rate_limited");
      return J(429, {
        error: "rate_limited",
        message: "That is several documents in a short time. Try again shortly.",
      }, { "retry-after": String(bucket.retryAfter) });
    }
    const budget = await takeDailyBudget();
    if (!budget.ok) {
      note("daily_cap_hit", { used: budget.used, cap: budget.cap });
      return J(503, {
        error: "daily_cap",
        message: "The Kurultai has sat its last council for today. Come back tomorrow, or write to Kathleen for the full document.",
      });
    }
  } catch (e) {
    // A limiter that is down must not become an open door.
    console.error("limiter_unavailable", e?.name);
    return J(503, { error: "unavailable", message: "Temporarily unavailable. Try again shortly." });
  }

  // ---- 3. hand it to the worker and give the caller a ticket ----
  const id = randomUUID();
  try {
    await ddb.send(new PutCommand({
      TableName: CONFIG.tableName,
      Item: {
        pk: "job#" + id,
        status: "running",
        created: now(),
        expires: now() + CONFIG.resultTtlSeconds,
      },
    }));
    await lambda.send(new InvokeCommand({
      FunctionName: CONFIG.selfFunction,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ kurultaiJob: { id, intake: v.intake, demo: v.demo } })),
    }));
  } catch (e) {
    console.error("enqueue_failed", e?.name);
    return J(503, { error: "unavailable", message: "Could not convene. Try again shortly." });
  }
  note("run_started", { chars: TEXT_FIELDS.reduce((n, f) => n + (v.intake[f]?.length || 0), 0) });
  return J(202, { status: "running", id });
}
