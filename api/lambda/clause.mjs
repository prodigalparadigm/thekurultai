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
  /\bconsolidat(?:e|es|ing|ion)\s+(?:of\s+)?(?:[\w-]+\s+){0,2}roles?\b/i,
  /\brole\s+consolidation\b/i,
  // found by the 1 Nov stress test: a count target on a role noun, and the
  // euphemism that no word list will ever fully cover - this catches the
  // common shape rather than pretending to catch all of them
  /\breduc(?:e|es|ed|ing)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}(?:roles?|positions?|jobs?|head\s?count|staff|teams?|agents?|reps?|analysts?|clerks?|adjusters?|drivers?|advisors?|coordinators?)\b/i,
  /\b(?:roles?|positions?|jobs?|head\s?count|staff|teams?|agents?|reps?|analysts?|clerks?|adjusters?|drivers?|advisors?|coordinators?)\s+(?:from\s+\d+\s+)?to\s+\d+\b/i,
  /\boff\s+the\s+payroll\b/i,
  /\bexit(?:ing)?\s+(?:the\s+)?(?:[\w-]+\s+){0,2}(?:roles?|positions?|jobs?|head\s?count|staff|teams?|agents?|reps?|analysts?|clerks?|adjusters?|drivers?|advisors?|coordinators?)\b/i,
  /\b(?:head\s?count|workforce|staff|fte)\s+reduction/i,
  /\breduction\s+in\s+(?:force|head\s?count|staff)\b/i,
  /\breduction[- ]in[- ]force\b/i,
  /\bRIF\b/,
  /\blay\s?off(?:s|ing)?\b/i,
  /\blaid\s+off\b/i,
  /\bmade\s+redundant\b/i,
  /\bredundanc(?:y|ies)\s+(?:pay|package|payment|programme|program|consultation)\b/i,
  /\bdownsiz(?:e|ing)\b/i,
  /\brightsiz(?:e|ing)\b/i,
  /\bsever(?:ance)\s+(?:plan|package|budget)/i,
  /\beliminat(?:e|ing|ion)\s+(?:of\s+)?(?:\w+\s+){0,3}(?:roles?|positions?|jobs?|head\s?count)/i,
  /\bcut\s+(?:the\s+)?(?:[\w-]+\s+){0,3}(?:roles?|positions?|jobs?|head\s?count|staff|teams?|agents?|reps?|analysts?|clerks?|adjusters?|drivers?|advisors?|coordinators?)\b/i,
  /\battrition\s+target/i,
  /\bbackfill\s+freeze\b/i,
  /\b(?:do\s+not|don't|avoid|stop)\s+backfill/i,
  /\blet\s+go\s+of\s+(?:[\w-]+\s+){0,3}(?:roles?|positions?|staff|people|analysts?|agents?|adjusters?|coordinators?)\b/i,
  /\bposts?\s+redundant\b/i,
  /\bhiring\s+freeze\b/i,
  /\bhead\s?count\s+sav(?:ing|ings)/i,
  /\bfte\s+sav(?:ing|ings)/i,
  /\breplace\s+(?:the\s+)?(?:[\w-]+\s+){0,3}(?:roles?|positions?|jobs?|head\s?count|staff|teams?|agents?|reps?|analysts?|clerks?|adjusters?|drivers?|advisors?|coordinators?|people|workers?)\s+with\b/i,
];

/* Sentences that are allowed to contain the words because they are the product
   saying what it will not do. Checked first; a line that matches one of these
   is not evidence of a breach. */
/* These stay exempt whatever else the sentence does: they are the product
   saying what it will not do, and it must be able to say so plainly. */
const EXEMPT_ALWAYS = [
  /does not produce headcount[- ]reduction/i,
  /won'?t write your layoff plan/i,
  /will not write your layoff plan/i,
  /not a layoff plan/i,
  /not a workforce[- ]reduction/i,
  /is not the product/i,
  /is not what (?:this|the kurultai)/i,
  /(?:does|do|will|can) not (?:produce|recommend|write|provide|include)/i,
];

/* Reporting the buyer's request back to them. Innocent on its own; not
   innocent when the same sentence also issues the instruction. */
const ATTRIBUTION = [
  /\byou asked\b/i,
  /\byou (?:have )?requested\b/i,
  /\byou are asking\b/i,
  /\byou came (?:here )?for\b/i,
  /\bwhat you asked for\b/i,
  /\bthe (?:intake|brief) (?:asks|asked|requests)\b/i,
  /\byour brief\b/i,
];

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
  /* A layoff can be the buyer's subject matter rather than our proposal. A
     workforce board processes layoff notices; an outplacement firm serves
     laid-off workers. The 1 Nov evening test found both being blocked. */
  /\blay\s?offs?[\s-]+(?:notice|notification|list|paperwork|process|filing|claim|report|rule|law|act)/i,
  /\blaid[\s-]off\s+(?:worker|employee|staff|people|person|client|participant|member)/i,
  /\bWARN\s+Act\b/i,
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
/* Reducing TIME is the product's whole point; reducing PEOPLE is the thing it
   will not do. The hardened patterns could not tell them apart, so "Reduce
   agent handle time" and "Cut analyst time on the close" were being blocked -
   17 of 18 ordinary sentences in the 1 Nov evening test. If the object of the
   verb is time, the sentence is not a breach. */
const TIME_OBJECT = /\b(?:handle\s+time|cycle\s+time|wait\s+time|turnaround|time|hours?|minutes?|days?|overtime|rework|backlog|queue|effort|toil|delay|latency)\b/i;
const CUTS_TIME = (sentence) => {
  const m = /\b(?:reduc\w*|cut\w*|trim\w*|shrink\w*)\b([\s\S]{0,60})/i.exec(sentence);
  return Boolean(m && TIME_OBJECT.test(m[1]));
};

const NAMING_OK = (path) =>
  path === "capacity_statement" || path === "lead" ||
  /^reading\./.test(path) || /^open_questions\[/.test(path) ||
  /\.process$/.test(path) || /hiring_note$/.test(path);

/* The title is the buyer's own organization name with "'s Kurultai" after it.
   A grant fund called the Regional Innovation Fund puts "RIF" in it, and the
   guard killed that run twice on both attempts - no retry can fix a trigger
   that is the customer's name. Never scanned. */
const NEVER_SCAN = (path) => path === "title";

const ADVOCACY = [
  /\brecommend/i, /\bwe advise\b/i, /\byou should\b/i, /\bshould\b/i,
  /\bpropose/i, /\bplan to\b/i, /\bthe plan is\b/i, /\broadmap\b/i,
  /\bphase \d/i, /\bby day \d/i, /\bnext step\b/i, /\btarget of\b/i,
  /\bbegin by\b/i, /\bstart by\b/i, /\bimplement/i, /\bexecute\b/i,
];

/* A bare imperative is advocacy without ever using an advocating word.
   "Reduce headcount to 30 by Q2, as you asked" is an instruction, and the
   attribution at the end does not turn it into a report. This is the one
   signal that overrides attribution. */
const IMPERATIVE = [
  /(?:^|[,;:]\s*)(?:reduce|cut|eliminate|remove|replace|trim|shrink|downsize|rightsize|consolidate|move|exit|lay\s*off|let\s+go)\b/i,
];

/* Returns [] when the document is clean, otherwise one finding per hit.
   Walks the parsed object so a finding can name the field it came from. */
export function clauseFindings(doc, path = "", intake = "", orgName = "") {
  /* Text the buyer typed is not a recommendation we made. A workforce board
     whose job is WARN Act layoff notices will have "layoff" all over its
     intake, and quoting it back is correct behaviour. */
  const echoed = String(intake || "").toLowerCase();

  /* The organization's own name is the sharpest case. A grant fund called the
     Regional Innovation Fund puts "RIF" into the title and into any sentence
     that names the client, and the guard killed that run twice. Skipping the
     title alone was not enough - the name turns up in the prose too - so the
     name is redacted out of every sentence before matching. */
  const org = String(orgName || "").trim();
  const strip = org
    ? (t) => t.replace(new RegExp(org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    : (t) => t;
  const out = [];
  const walk = (node, p) => {
    if (typeof node === "string") {
      if (NEVER_SCAN(p)) return;
      const naming = NAMING_OK(p);
      for (const raw of node.split(/(?<=[.;:!?])\s+/)) {
        const sentence = strip(raw);
        /* An exemption says "these words are here for an innocent reason".
           Attribution - "as you asked" - is only innocent while the sentence
           is reporting the request. A sentence that attributes AND advocates
           in the same breath ("as you asked, reduce headcount to 30") was
           skipped outright by the old order of these checks. The stress test
           walked two sentences straight through on exactly that. */
        /* Precedence, most decisive first:
             1. the product's own refusal lines are always allowed
             2. a bare imperative is always a breach, whatever else is present
             3. attribution ("you asked for X") is a report, so allowed
             4. otherwise the ordinary exemptions, then advocacy  */
        if (EXEMPT_ALWAYS.some((e) => e.test(sentence))) continue;
        if (CUTS_TIME(sentence)) continue;
        if (echoed && echoed.includes(sentence.trim().toLowerCase())) continue;
        const commanding = IMPERATIVE.some((a) => a.test(sentence));
        if (!commanding) {
          if (ATTRIBUTION.some((a) => a.test(sentence))) continue;
          if (EXEMPT.some((e) => e.test(sentence))) continue;
          if (naming && !ADVOCACY.some((a) => a.test(sentence))) continue;
        }
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
