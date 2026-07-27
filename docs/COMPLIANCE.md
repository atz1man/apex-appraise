# Compliance — AI use in valuations

RICS professional standards require a valuer to be transparent about whether and how
artificial intelligence was used on an instruction. Apex treats that as a product
requirement, not a policy document: the disclosure is derived from what actually happened.

## How the disclosure is produced

1. Every AI touchpoint writes an `ActivityEvent` under the actor `AI Development Director`.
2. `apps/api/src/ai-disclosure.ts` is the register: one entry per touchpoint, holding the
   event action it matches, the client-facing label, and the sentence describing what it did.
3. `appraisal.aiDisclosure(dealId)` reads the deal's audit trail, keeps only touchpoints that
   actually ran, and returns them with counts, last-used timestamps and the model that drafted
   any prose currently reproduced in the report.
4. The appraisal report and the Red Book print that list, followed by the standing statement.
   When nothing ran, they state that no AI was used — silence is not a disclosure.
5. `AI use on this deal` on the deal overview shows the valuer the same record before issue.

**Adding an AI feature? Write the ActivityEvent and add the touchpoint to the register.**
An AI call that skips either is an undisclosed one. `scenarios.draftRisk` shipped without an
audit event and was invisible to the trail until 2026-07-26 — that is the failure mode.

## The standing statement

> No artificial intelligence system computed, adjusted or approved any figure in this
> valuation. All monetary outputs are produced by the deterministic Apex Appraise engine from
> inputs accepted by the valuer, who retains full professional responsibility for the
> valuation and its conclusions.

This is true by construction, not by assertion: money maths lives only in
`packages/appraisal-engine`, and the LLM boundaries (`extract.ts`, narrative and Q&A
procedures) return prose or extracted inputs — never computed figures.

## Report pagination

Both reports state `Page n of N` and the PDFs must print exactly N sheets. Two things keep
that true and are easy to break:

- A4 pages are sized `minHeight: 1122`, not 1123 — chromium prints A4 at 1122.5px, so a page
  sized to the rounded-up height spills a blank sheet.
- `.a4-page:last-child` resets `page-break-after` to `auto`; otherwise the final forced break
  emits a trailing blank sheet.

Red Book pagination is dynamic: AI-drafted commentary earns its own sheet (7 pages), and
without a narrative the report is 6. Verify with a real render, not by reading the JSX:

```bash
curl -s "http://localhost:4100/reports/<dealId>/redbook.pdf?t=<token>" -o /tmp/r.pdf
python3 -c "import re;d=open('/tmp/r.pdf','rb').read();print(len(re.findall(rb'/Type\s*/Page[^s]',d)))"
```

## Terms of engagement and e-signature

Terms of engagement (VPS 1) are drafted from the deal, issued, and signed by the client.
Issuing mints a 24-byte random signing token; the client opens `/terms/<token>` with no
account and signs by typing their name and agreeing explicitly. What makes that defensible
later is the evidence stored alongside it: `signedName`, `signedAt`, `signedIp`,
`signedUserAgent`, plus an audit event naming the signatory.

Rules the implementation holds to:

- The token IS the credential. Anyone holding the link can sign, so it is treated like the
  document itself and `/terms/` is disallowed in robots.txt.
- Issuing or re-issuing mints a fresh token; withdrawing clears it. A withdrawn or draft
  record is not signable and its link resolves to "no longer valid".
- The public endpoint returns the document and nothing else — no ids, no org internals, no
  IP of a previous signatory.
- Signing twice is refused; the executed document is shown instead.
- A signature made on paper can still be recorded manually by the valuer, labelled as such.

The `signToken` column is indexed but deliberately NOT unique: a unique constraint makes the
boot-time `prisma db push` demand `--accept-data-loss`, and that flag does not belong on a
production start command.

## What is not covered yet

- No firm-level AI policy statement is stored; the wording above is fixed in code.
- Signing links do not expire on a timer — they are revoked by withdrawing or re-issuing.
- No email is sent: the valuer copies the link. SMTP is not configured.
