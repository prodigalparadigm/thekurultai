/* ---------- John's Clause, checked in code ----------
   No dependencies, on purpose: the QA harness runs this without installing
   anything, and the rule lives in exactly one place.
   The engine's instructions are the first line and they hold almost always.
   This is the second line, and it is the one allowed to refuse to ship.
   Enforced, not hoped: the string the model wrote is searched, and a hit stops
   the document. Phrased as whole-phrase patterns so that honest sentences -
   "adoption at zero layoffs", "this is not a layoff plan" - do not trip it. */
const FORBIDDEN = [
  /\breduc(?:e|es|ed|ing)\s+(?:the\s+|its\s+|our\s+|their\s+)?(?:head\s?count|staff|staffing|workforce|fte|roles?|positions?|jobs?|team)/i,
  /\b(?:trim|trimming|shrink|shrinking)\s+(?:the\s+|its\s+|our\s+)?(?:head\s?count|staff|workforce|team|roles?)/i,
  /\bhead\s?count\s+(?:comes\s+)?(?:down|falls|drops)/i,
  /\bconsolidat(?:e|es|ing|ion)\s+(?:of\s+)?(?:\w+\s+){0,2}roles?\b/i,
  /\brole\s+consolidation\b/i,
  /\b(?:head\s?count|workforce|staff|fte)\s+reduction/i,
  /\breduction\s+in\s+(?:force|head\s?count|staff)\b/i,
  /\breduction[- ]in[- ]force\b/i,
  /\bRIF\b/,
  /\blay\s?off(?:s|ing)?\b/i,
  /\blaid\s+off\b/i,
  /\bredundanc(?:y|ies)\b/i,
  /\bdownsiz(?:e|ing)\b/i,
  /\brightsiz(?:e|ing)\b/i,
  /\bsever(?:ance)\s+(?:plan|package|budget)/i,
  /\beliminat(?:e|ing|ion)\s+(?:of\s+)?(?:\w+\s+){0,3}(?:roles?|positions?|jobs?|head\s?count)/i,
  /\bcut\s+(?:\w+\s+){0,2}(?:roles?|positions?|jobs?|head\s?count|staff)/i,
  /\battrition\s+target/i,
  /\bbackfill\s+freeze\b/i,
  /\bhiring\s+freeze\b/i,
  /\bhead\s?count\s+sav(?:ing|ings)/i,
  /\bfte\s+sav(?:ing|ings)/i,
  /\breplace\s+(?:the\s+)?(?:\w+\s+){0,2}(?:team|staff|people|workers?)\s+with\b/i,
];

/* Sentences that are allowed to contain the words because they are the product
   saying what it will not do. Checked first; a line that matches one of these
   is not evidence of a breach. */
const EXEMPT = [
  /does not produce headcount[- ]reduction/i,
  /won'?t write your layoff plan/i,
  /will not write your layoff plan/i,
  /not a layoff plan/i,
  /not a workforce[- ]reduction/i,
  /is not the product/i,
  /is not what (?:this|the kurultai)/i,
  /at zero layoffs/i,
  /without layoffs/i,
  /no layoffs/i,
  /(?:does|do|will|can) not (?:produce|recommend|write|provide|include)/i,
  /\brather than (?:cutting|reducing|eliminating)/i,
  /\binstead of (?:cutting|reducing|eliminating)/i,
  // attribution: repeating back what the buyer asked for is not advocating it
  /\byou asked\b/i,
  /\byou (?:have )?requested\b/i,
  /\byou are asking\b/i,
  /\byou came (?:here )?for\b/i,
  /\bwhat you asked for\b/i,
  /\bthe (?:intake|brief) (?:asks|asked|requests)\b/i,
  /\byour brief\b/i,
];

/* ---------- naming is not recommending ----------
   Two fields have to be able to say the words. `process` quotes the buyer's
   own description of their work back to them - the audit names processes in
   their words, and a buyer who wrote "automate this so I can cut headcount"
   must be quotable. `capacity_statement` is where the spec REQUIRES the
   document to say plainly that headcount reduction is not what this produces.

   The first version of this checker policed mention rather than
   recommendation, so it flagged both, and the corrective retry then told the
   model to delete the refusal sentence it was obliged to write. The rail was
   fighting the spec. In these two fields a forbidden term is a breach only
   when the same sentence is also ADVOCATING - telling them to do it. */
const NAMING_OK = (path) => path === "capacity_statement" || /\.process$/.test(path);

const ADVOCACY = [
  /\brecommend/i, /\bwe advise\b/i, /\byou should\b/i, /\bshould\b/i,
  /\bpropose/i, /\bplan to\b/i, /\bthe plan is\b/i, /\broadmap\b/i,
  /\bphase \d/i, /\bby day \d/i, /\bnext step\b/i, /\btarget of\b/i,
  /\bbegin by\b/i, /\bstart by\b/i, /\bimplement/i, /\bexecute\b/i,
];

/* Returns [] when the document is clean, otherwise one finding per hit.
   Walks the parsed object so a finding can name the field it came from. */
export function clauseFindings(doc, path = "") {
  const out = [];
  const walk = (node, p) => {
    if (typeof node === "string") {
      const naming = NAMING_OK(p);
      for (const sentence of node.split(/(?<=[.;:!?])\s+/)) {
        if (EXEMPT.some((e) => e.test(sentence))) continue;
        // in a quoting or refusing field, the words alone are not a breach
        if (naming && !ADVOCACY.some((a) => a.test(sentence))) continue;
        for (const re of FORBIDDEN) {
          const m = re.exec(sentence);
          if (m) out.push({ field: p, pattern: String(re), text: sentence.trim().slice(0, 240) });
        }
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (node && typeof node === "object")
      return Object.entries(node).forEach(([k, v]) => walk(v, p ? `${p}.${k}` : k));
  };
  walk(doc, path);
  return out;
}

/* The corrective sent back on the one retry a breach is allowed. */
export const CLAUSE_RETRY = [
  "That draft broke John's Clause. These passages RECOMMEND or price headcount",
  "reduction, which this product does not do under any circumstances:",
  "",
  "%FINDINGS%",
  "",
  "Write the document again. Keep everything else, and change only those",
  "passages. Where one pointed at reducing people, replace it with the capacity",
  "decision that belongs there: what is freed, who decides where it goes, by",
  "when, and which of redeployment, MyWork or growth it lands in.",
  "",
  "To be clear about what is NOT the problem, because removing it would be a",
  "different error: you may and should still quote the buyer's own words back",
  "in a process name, and capacity_statement must still say plainly that",
  "headcount reduction is not what the Kurultai produces when they asked for",
  "it. Naming the thing you will not do is required. Recommending it is not.",
].join("\n");
