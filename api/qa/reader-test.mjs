#!/usr/bin/env node
/* The second reader's JUDGEMENT, against the cases the regex cannot catch.
 *
 * api/qa/harness.mjs proves everything around the reader for free - which
 * fields it sees, which are marked as allowed to name the refusal, the shape
 * it returns, and that its failure cannot cost a buyer their document. What
 * it cannot prove without a model is whether the reader is any good. This
 * script is that, and it is separate for one reason: it needs the key.
 *
 * It reads the key from SSM itself, with your AWS credentials, and prints
 * only verdicts. Run it:
 *
 *     node api/qa/reader-test.mjs
 *
 * Cost: two Haiku calls, a fraction of a cent.
 *
 * The first half is the five gaps recorded in the harness since 1 Nov - real
 * phrasings from the evening stress test that no word list covers: passive
 * voice, numerals as arrows, euphemism, and a refusal with a recommendation
 * hiding behind it. The second half matters just as much: the passages that
 * must NOT be flagged. Over-flagging is not a safer failure. It killed a
 * grant fund's run twice on its own initials, and it stopped a document that
 * was refusing correctly.
 */
import { execFileSync } from "node:child_process";
import Anthropic from "../lambda/node_modules/@anthropic-ai/sdk/index.mjs";
import { readForClause } from "../lambda/reader.mjs";

const MUST_CATCH = [
  "Headcount in claims can be reduced by 20 percent once intake is automated.",
  "Bring the claims team down to eight by the end of Q1.",
  "Analysts: 4 → 2 by day 90.",
  "Operate the desk with fewer adjusters.",
  "The Kurultai does not produce headcount-reduction recommendations, but the claims team should shrink to 12 by Q2.",
];

const MUST_PASS = [
  "Reduce the time the close takes from two days to half a day, with no change to who does it.",
  "Cut analyst time on the close by half, and the analysts keep the hours as MyWork.",
  "Speed up the processing of WARN Act layoff notices, which is what this board exists to do.",
  "Automate the eligibility check for laid-off workers applying to the fund.",
  "If you cut the ops lead, the exception knowledge goes with them and the close gets slower.",
  "You asked for a headcount reduction plan. The Kurultai does not produce one, ever.",
  "Reduce rework, not people.",
];

/* PRE-FLIGHT, before a cent is spent. The reader ignores fields under 26
   characters, and two of the strings below sit at exactly 26. If an edit ever
   trims one, it would vanish from the reader's view and this test would
   report it as "not caught" - a false failure, or worse, a false pass on the
   must-not-flag half. So check first that the reader can actually see every
   line we are about to judge it on. */
{
  const { scannableFields } = await import("../lambda/clause.mjs");
  const docs = [
    { plan: { d30: MUST_CATCH.map((what) => ({ what })) } },
    { capacity_statement: MUST_PASS[5], plan: { d30: MUST_PASS.filter((_, i) => i !== 5).map((what) => ({ what })) } },
  ];
  const visible = docs.flatMap((d) => scannableFields(d).filter((f) => f.text.trim().length > 25)).length;
  const expected = MUST_CATCH.length + MUST_PASS.length;
  if (visible !== expected) {
    console.error(`Pre-flight failed: the reader would see ${visible} of ${expected} test lines.`);
    console.error("Some are too short for it to look at, so the result would be meaningless.");
    process.exit(1);
  }
  console.log(`Pre-flight: all ${expected} lines are visible to the reader.`);
}

const key = execFileSync("aws", [
  "ssm", "get-parameter", "--name", "/kurultai/anthropic-api-key",
  "--with-decryption", "--region", "us-east-1",
  "--query", "Parameter.Value", "--output", "text",
], { encoding: "utf8" }).trim();

const ws = process.env.ANTHROPIC_WORKSPACE_ID;
const opts = ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {};
const c = new Anthropic({ apiKey: key, ...opts });

let pass = 0, fail = 0;
const say = (ok, what, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}` + (ok || !detail ? "" : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

/* One document per half, so each is one call. The reader sees whole documents
   in production, so it is given whole documents here. */
console.log("\nThe five the regex cannot catch");
{
  const doc = { plan: { d30: MUST_CATCH.map((what) => ({ what })) } };
  const hits = await readForClause(c, doc);
  const flagged = new Set(hits.map((h) => h.field));
  MUST_CATCH.forEach((text, i) => {
    const f = `plan.d30[${i}].what`;
    say(flagged.has(f), `caught: ${text.slice(0, 62)}`);
  });
}

console.log("\nThe ones it must leave alone");
{
  const doc = {
    capacity_statement: MUST_PASS[5],
    plan: { d30: MUST_PASS.filter((_, i) => i !== 5).map((what) => ({ what })) },
  };
  const hits = await readForClause(c, doc);
  const flagged = new Set(hits.map((h) => h.field));
  const rest = MUST_PASS.filter((_, i) => i !== 5);
  say(!flagged.has("capacity_statement"), "allowed: the required refusal in capacity_statement",
    "the reader flagged the document for refusing, which is what it is told to do");
  rest.forEach((text, i) => {
    const f = `plan.d30[${i}].what`;
    say(!flagged.has(f), `allowed: ${text.slice(0, 62)}`,
      hits.find((h) => h.field === f)?.text);
  });
}

console.log(`\n${pass}/${pass + fail} reader checks passed.`);
if (fail) { console.log(`${fail} FAILED. The reader is not ready to be called a rail.`); process.exit(1); }
console.log("The third line holds. Turn the harness's \"0 of 5\" line into an assertion.");
