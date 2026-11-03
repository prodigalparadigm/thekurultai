#!/usr/bin/env node
/* Read a finished document the way a person reads it, and say what is wrong
 * with the prose.
 *
 * WHY THIS EXISTS. On 3 Nov the harness passed 164 checks while four faults
 * sat on every document the product had ever produced: a sentence with no
 * subject, a raw database value printed in a table cell, an acronym
 * lowercased into a typo, and a document that pointed at a table which was
 * not where it said it was. All four were obvious to anyone reading a
 * finished document start to finish. None were visible to a single assertion,
 * because assertions test structure and these were faults in writing.
 *
 * Three of the four existed ONLY in the rendered page, not in the JSON the
 * engine returned - they were introduced by the renderer. So this reads the
 * PAGE, not the model's output.
 *
 * Usage:
 *   node api/qa/proofread.mjs https://thekurultai.com/editions/sample-harbour-freight.html
 *   node api/qa/proofread.mjs editions/sample-harbour-freight.html
 *
 * It reads the key from SSM with your AWS credentials and prints only
 * findings. Cost: one call, a few cents. Run it on anything before it ships
 * with Kathleen's name on it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Anthropic from "../lambda/node_modules/@anthropic-ai/sdk/index.mjs";
import { zodOutputFormat } from "../lambda/node_modules/@anthropic-ai/sdk/helpers/zod.mjs";
import { z } from "../lambda/node_modules/zod/index.js";

const target = process.argv[2];
if (!target) { console.error("Give me a URL or a path to an HTML file."); process.exit(1); }

const html = /^https?:/.test(target)
  ? await fetch(target).then((r) => r.text())
  : readFileSync(target, "utf8");

/* Our own markup, so a plain strip is enough. Script, style and comments go
   first or their contents read as prose. */
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<\/(p|h[1-6]|li|tr|section|div|article)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, "·")
  .replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

const Findings = z.object({
  findings: z.array(z.object({
    kind: z.string(),      // grammar | contradiction | raw-value | unsourced | awkward
    quote: z.string(),
    problem: z.string(),
    severity: z.string(),  // high | medium | low
  })),
});

const INSTRUCTIONS = [
  "You are proofreading a finished document that is about to be published by a",
  "consultancy whose entire product is rigour. Read it the way a hostile reader",
  "would. Report only real faults, quoting the exact text.",
  "",
  "Look for, in this order of importance:",
  "",
  "1. GRAMMAR. Sentences that are ungrammatical, incomplete, or missing a",
  "   subject or antecedent. A real example that shipped for two days: \"The",
  "   staged pattern that describes is a working one\" - 'that describes' has no",
  "   subject. These are the worst because they are indefensible.",
  "",
  "2. CONTRADICTION. Any place the document contradicts itself. A real example:",
  "   a header field reading \"strong-PMF\" while a later section says \"you are",
  "   not searching for product-market fit\".",
  "",
  "3. RAW VALUES. Anything that looks like a database value or code identifier",
  "   printed where prose belongs: lowercase single words in a column of",
  "   capitalised ones, snake_case, an acronym whose case has been flattened",
  "   (\"strong-pmf\" for \"strong-PMF\").",
  "",
  "4. POINTING. Text that refers to another part of the document by position -",
  "   \"the table above\", \"each row below\" - which may be wrong once laid out.",
  "",
  "5. UNSOURCED CLAIMS. Empirical assertions about the world stated as fact",
  "   with no source, especially in a document that elsewhere says no outside",
  "   research was performed.",
  "",
  "DO NOT report: house style you merely dislike, deliberate sentence",
  "fragments used for rhetorical effect, British spelling, or the document's",
  "opinions. Do not suggest rewrites of things that are already correct. An",
  "empty list is a perfectly good answer.",
].join("\n");

const key = execFileSync("aws", [
  "ssm", "get-parameter", "--name", "/kurultai/anthropic-api-key",
  "--with-decryption", "--region", "us-east-1",
  "--query", "Parameter.Value", "--output", "text",
], { encoding: "utf8" }).trim();

const ws = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic({
  apiKey: key,
  ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}),
});

console.log(`Reading ${target}\n${text.split(/\s+/).length} words.\n`);

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 8000,
  system: INSTRUCTIONS,
  messages: [{ role: "user", content: text }],
  output_config: { format: zodOutputFormat(Findings), effort: "high" },
});

const found = res.parsed_output?.findings ?? [];
if (!found.length) { console.log("Nothing found. That is the expected answer for a clean page."); process.exit(0); }

const rank = { high: 0, medium: 1, low: 2 };
found.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
for (const f of found) {
  console.log(`[${(f.severity || "?").toUpperCase()}] ${f.kind}`);
  console.log(`  "${f.quote}"`);
  console.log(`  ${f.problem}\n`);
}
console.log(`${found.length} finding(s). Severity is the model's opinion; the quote is the fact.`);
