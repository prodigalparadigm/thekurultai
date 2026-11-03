/* John's Clause, third line.
 *
 * The first line is the engine's own instructions, and it has held in every
 * live run of both stress tests. The second is clause.mjs, a regex backstop
 * that the harness has always reported honestly: 0 of 5 of the adversarial
 * cases are caught by the regex alone. So until now the one promise this
 * product is named for rested on a single layer, and the layer described as
 * the backstop caught nothing the first layer had not already stopped.
 *
 * This is a reader. It takes the finished document and asks a small model the
 * only question that matters - does any of this ADVOCATE fewer people - with
 * the same naming-versus-advocating distinction the regex uses, because a
 * document is REQUIRED to name the refusal when a buyer asks for a layoff
 * plan. Getting that distinction wrong once made the rail fight the spec and
 * fail the hardest case closed; it is not going to be re-litigated here, so
 * the field list comes from clause.mjs rather than from a second opinion
 * about which fields count.
 *
 * WHAT IT COSTS: one Haiku call per run, a few thousand input tokens and a
 * very short output - well under a cent against a run that costs about $0.55.
 *
 * WHAT IT DOES ON FAILURE: nothing. A reader that cannot be reached must not
 * cost a buyer the document they waited minutes for, and the two layers above
 * it still ran. It is tried once, its failure is logged as a shape, and the
 * run continues. That is a deliberate asymmetry: this layer can only ever add
 * catches, never subtract documents.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { scannableFields } from "./clause.mjs";

/* Haiku, not the document model. The question is a classification, not an
   argument, and a cheap reader that runs every time beats an expensive one
   that gets switched off the first month the bill lands. */
export const READER_MODEL = "claude-haiku-4-5-20251001";

const Verdict = z.object({
  breaches: z.array(z.object({
    id: z.number(),
    quote: z.string(),
    why: z.string(),
  })),
});

const INSTRUCTIONS = [
  "You are reading a finished strategy document for ONE thing, and you have no",
  "other job. The product that wrote it does not produce headcount-reduction",
  "recommendations, ever, and says so in public.",
  "",
  "Return the id of every passage that RECOMMENDS, ADVISES, PRICES or PLANS a",
  "reduction in people - layoffs, redundancies, attrition used as a cost lever,",
  "headcount targets, 'you could run this with four instead of six', replacing a",
  "named role, or a saving whose arithmetic is a salary.",
  "",
  "DO NOT FLAG - and this half matters as much as the other, because over-",
  "flagging has broken real buyers' documents before:",
  "  - NAMING the thing in order to REFUSE it. The document is REQUIRED to tell",
  "    a buyer who asked for a layoff plan that it will not write one. A passage",
  "    marked [may name] is one of those fields. Flag it only if it argues FOR",
  "    fewer people in the same breath as declining.",
  "  - Quoting the buyer's OWN words back to them, including their own request.",
  "  - Reducing TIME, effort, cycles, rework, handle time, queues or cost that",
  "    is not a salary. Less time spent is the product's whole purpose.",
  "  - Work about layoffs as a SUBJECT: a workforce board processing WARN Act",
  "    notices, a fund serving laid-off workers. The subject is not the advice.",
  "  - Warning that something WOULD cost knowledge or people if done. A warning",
  "    against a cut is the opposite of recommending one.",
  "",
  "Quote the exact sentence. If nothing qualifies, return an empty list. An",
  "empty list is the expected answer and is not a failure to find something.",
].join("\n");

export async function readForClause(client, doc, note = () => {}) {
  /* Only the fields that could carry a recommendation, numbered, with the
     ones the spec lets name the refusal marked as such. */
  const fields = scannableFields(doc).filter((f) => f.text.trim().length > 25);
  if (!fields.length) return [];

  const listing = fields
    .map((f, i) => `[${i}]${f.naming ? " [may name]" : ""} ${f.path}\n${f.text}`)
    .join("\n\n");

  /* parse(), NOT create(). create() returns a plain Message and never
     populates parsed_output - so the first deployed version of this reader
     called create(), got nothing back, and returned silently on every run
     while still paying for the Haiku call. A rail that quietly does nothing
     is worse than no rail, which is the entire reason this file exists. The
     canary caught it; the harness now asserts it. */
  const res = await client.messages.parse({
    model: READER_MODEL,
    max_tokens: 2000,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: "Read these passages.\n\n" + listing }],
    output_config: { format: zodOutputFormat(Verdict) },
  });

  const parsed = res.parsed_output;
  if (!parsed) {
    /* Never silent. A reader that returns nothing because it is working and a
       reader that returns nothing because it is broken look identical from
       the outside, and the second one is how a safety layer becomes
       decorative without anybody noticing. */
    console.error("reader_no_output", res?.stop_reason || "unknown");
    note("reader_no_output", { stop: res?.stop_reason || "unknown" });
    return [];
  }
  note("reader_done", {
    fields: fields.length,
    breaches: parsed.breaches.length,
    input: res.usage?.input_tokens ?? 0,
    output: res.usage?.output_tokens ?? 0,
  });

  /* Shaped exactly like a clauseFindings() result, so the existing retry path
     does not need to know which layer found the problem. */
  return parsed.breaches
    .filter((b) => fields[b.id])
    .map((b) => ({
      field: fields[b.id].path,
      pattern: "second reader",
      text: String(b.quote || "").trim().slice(0, 240),
    }));
}
