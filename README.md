# The Kurultai

**[thekurultai.com](https://thekurultai.com)** - an AI strategy built from what
a company actually does all day and who actually does it.

Bring your processes in your own words and your staffing reality in plain
words. Four sliders place you, and out comes a document: a ceremony audit, a
management-decision ledger, a people arc, a staffing map, ninety days, and a
governance starter. Free sketch, no account, nothing kept.

By Kathleen Bartin, Prodigal Paradigm LLC, built with Claude.

## It will not write your layoff plan

The Kurultai does not produce headcount-reduction recommendations, ever. Not as
a line item, not as a quantified benefit, not as attrition you were going to
have anyway. What it produces instead is a capacity plan: every hour the work
frees up is entered in the ledger as a decision a named role makes by a named
date.

That is a promise made in public, so it is enforced where you can check it:
once in the engine's instructions ([api/lambda/engine.mjs](api/lambda/engine.mjs)),
and again in code on the way out ([api/lambda/clause.mjs](api/lambda/clause.mjs)),
where a breach gets one corrective retry and then fails the job rather than
returning the document. The test battery that holds it to that is in
[api/qa/harness.mjs](api/qa/harness.mjs), including a buyer who sits down and
asks for the layoff plan outright.

## What is in here

    index.html          the landing page, the instrument, the brief
    report.html         a sample DETAILED document, fictional organization
    patron.html         Sorghaghtani Beki, and why the name
    identity.html       the design record (noindex, not a public page)
    style.css, app.js   the design system and the instrument
    api/                the engine: Lambda, API Gateway, DynamoDB
    api/canon/          the slider poles, verbatim, as the source of truth
    api/qa/harness.mjs  what has to pass before this ships

The visual identity, the page architecture and `style.css` come from the brand
concept delivered 1 November 2026: the mark, the ink/paper/vermilion palette,
Cormorant Garamond over DM Sans carried across from the parent practice, the
vertical instrument with its keyboard and screen-reader semantics, and the
document typography in print and on screen. `identity.html` is that concept's
own design record and still lists what remains open.

## The four engines

**Ceremony audit.** Every process is sorted into instrumental, meaning it is
judged by whether it controls a future outcome, and ceremonial, meaning it runs
on precedent or displays status. Recommendations attach only to the first kind.
Point an instrumental tool at a ceremonial process and the process absorbs it
and produces more ceremony, faster.

**Management-decision ledger.** The washing machine gave households back hours
and the hours went straight back into the same work, because nobody decided
otherwise. Freed time stays free only by explicit decision, so each one is
assigned to a role with a date. The table is meant to be signed.

**People arc.** Document what you do all day, which is the only way to see what
hands off and what cannot; then work out what the job is now. Equipped,
oriented, builder, ready to write code with an agent.

**Staffing map.** Prototyper, builder, sweeper, grower, maintainer, mixed for
the stage you are actually at, with the hiring conversation named where hiring
enters.

Every recommendation in the document carries the future outcome it controls and
the evidence that would show it. That is the bar the audit applies to your
processes, so it is the bar the document has to meet itself.

## Running it

See [api/README.md](api/README.md) to deploy the engine, and
[api/SECURITY.md](api/SECURITY.md) for how the key is held and the bill is
bounded. The pages are static files; GitHub Pages serves them.
