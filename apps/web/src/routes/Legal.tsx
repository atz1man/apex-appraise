import { Link } from 'react-router-dom';
import { EyebrowTitle, TopBar } from '../components/ui';
import { DATA_SOURCES, ENTITY, SUBPROCESSORS, TRIAL_DAYS, entityLine } from '../legal/entity';

/**
 * The privacy notice and the terms, as pages rather than as two footer links
 * pointing at `#footer` — which is what they were, on a product that asks a firm
 * to upload its clients' documents.
 *
 * Written to describe what this system ACTUALLY does: the tables it stores, the
 * three companies that see any of it, the model that reads uploaded documents,
 * and the fact that the valuation opinion belongs to the valuer and never to the
 * software. Where a fact has not been established — the operating company's
 * number, the liability cap — the page says so instead of filling the gap in.
 */

function LegalShell({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-frame">
      <TopBar crumb={<Link to="/welcome" className="text-[13px] font-medium text-ink-2 hover:text-ink">Apex Appraise</Link>} />
      <div className="mx-auto max-w-[760px] px-6 py-10">
        <EyebrowTitle eyebrow={eyebrow} title={title} sub={sub} />
        {!ENTITY.confirmed && (
          /*
           * Not a disclaimer for its own sake. Until the operator is identified,
           * these pages cannot do the job the law asks of them, and a reader is
           * entitled to know that before they upload a client's file.
           */
          <div className="mt-6 rounded-[14px] border border-border-strong bg-surface p-4 text-[12.5px] leading-[1.6] text-ink-2">
            <strong className="font-semibold text-ink">Not yet in force.</strong> The operating company's registration
            details are being finalised, and these pages are published in draft so that what the product does with data is
            visible now rather than later. They take effect when the details below are complete and a paid subscription is
            first offered.
          </div>
        )}
        <div className="mt-7 flex flex-col gap-7">{children}</div>
        <div className="mt-10 pt-5 border-t border-border-std text-[12px] text-ink-3 leading-[1.6]">
          {entityLine()}
          <div className="mt-1">
            Privacy enquiries: {ENTITY.privacyContact} · Support: {ENTITY.supportContact}
          </div>
          <div className="mt-3 flex gap-4">
            <Link className="font-medium text-ink-2 hover:text-ink" to="/privacy">Privacy</Link>
            <Link className="font-medium text-ink-2 hover:text-ink" to="/terms">Terms</Link>
            <Link className="font-medium text-ink-2 hover:text-ink" to="/welcome">Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold tracking-[-0.3px]">{heading}</h2>
      <div className="mt-2 text-[13px] leading-[1.7] text-ink-2 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Privacy() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Privacy notice"
      sub="What this product stores, who else can see it, and how to get it back or have it deleted."
    >
      <Section heading="Who is responsible for what">
        <p>
          For the account itself — the workspace, its users and its billing — the operator named at the foot of this page
          is the data controller. For everything a firm puts <em>into</em> its workspace, the firm is the controller and
          this product is its processor: client names, site addresses, uploaded documents and valuations are the firm's
          records, held on its instructions.
        </p>
      </Section>

      <Section heading="What is stored">
        <p>
          Account data: name, email address, role, a password hash (never the password), and the workspace's plan and
          billing identifiers. Workspace data: deals, appraisals, comparables, inspections, units, tenancies, documents
          and photographs a firm uploads, engagement terms, report share links, and the firm's own standing wording.
        </p>
        <p>
          Two operational logs: an audit trail of who did what, and a fault log. Anything resembling a credential — a
          token, a key, a password, an email address inside an error message — is stripped before a fault is written
          down, because an error log is read by more people than a database is.
        </p>
        <p>
          IP addresses are seen in order to rate-limit and to lock an account after repeated failed sign-ins. There is no
          advertising, no analytics service and no tracking cookie; the sign-in token is held in the browser's own
          storage and goes nowhere else.
        </p>
      </Section>

      <Section heading="Documents, and the model that reads them">
        <p>
          When a document is used to generate an appraisal, its contents are sent to Anthropic's API so figures can be
          extracted — unit counts, areas, rates, planning conditions — each returned with a citation to where it was
          found. Report narrative is drafted the same way from figures the engine has already calculated.
        </p>
        <p>
          No model calculates a valuation. Every financial output is produced by the deterministic engine from inputs a
          valuer has accepted, and figures written into narrative are checked back against that engine's output before a
          draft is used. Sending a document is a choice made per deal: nothing is transmitted unless a document is
          selected for extraction.
        </p>
      </Section>

      <Section heading="Who else sees any of it">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="py-1.5 pr-3 font-medium">Company</th>
                <th className="py-1.5 pr-3 font-medium">Purpose</th>
                <th className="py-1.5 font-medium">Where</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-border-faint align-top">
                  <td className="py-1.5 pr-3 font-medium text-ink">{s.name}</td>
                  <td className="py-1.5 pr-3">{s.purpose}</td>
                  <td className="py-1.5">{s.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Nobody else. The application and its database run in London. Where a processor is outside the UK, the transfer
          relies on that provider's standard contractual clauses.
        </p>
        <p>
          Public data sources are queried for site information — {DATA_SOURCES.join(', ')} — but the traffic runs one
          way: a postcode goes out, published records come back. No client or workspace data is sent to them.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Workspace data is kept while the workspace exists. Deleting the workspace removes every row belonging to it in
          one transaction — there is no soft-delete and no shadow copy. The nightly backup keeps the 14 most recent
          database dumps and the same number of upload snapshots, after which they are pruned; a deleted workspace
          therefore disappears from backups within a fortnight. The fault log holds at most the 500 most recent distinct
          faults and prunes the oldest.
        </p>
      </Section>

      <Section heading="Your rights, and where the buttons are">
        <p>
          <strong className="font-semibold text-ink">Portability and access:</strong> Settings → an admin can export the
          entire workspace as a single JSON file, derived from the database schema so it cannot quietly omit a table.
          Credentials are excluded; everything else is included, in pence, as stored.
        </p>
        <p>
          <strong className="font-semibold text-ink">Erasure:</strong> Settings → delete workspace, confirmed by typing
          the workspace name. It is immediate and cannot be undone.
        </p>
        <p>
          <strong className="font-semibold text-ink">Rectification and objection:</strong> records are editable in the
          product; anything else, write to {ENTITY.privacyContact}. You may also complain to the Information
          Commissioner's Office (ico.org.uk).
          {ENTITY.icoRegistration && <> Our ICO registration is {ENTITY.icoRegistration}.</>}
        </p>
      </Section>
    </LegalShell>
  );
}

export function Terms() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Terms of service"
      sub="The agreement for using Apex Appraise, in the plainest language it can be written in."
    >
      <Section heading="What this product is, and what it is not">
        <p>
          Apex Appraise is software for preparing development appraisals and valuation reports. It is not a valuer, and
          it does not give valuation advice. Every figure it produces is calculated from inputs you provide or accept,
          and every opinion of value in a report it prints is <em>yours</em>: your professional judgement, your
          signature, your registration, and your firm's responsibility under the RICS Red Book and to your client.
        </p>
        <p>
          The product's job is to make that work faster and to keep every figure traceable to the evidence it came from.
          It is not a substitute for inspection, for professional scepticism, or for reading what you are signing.
        </p>
      </Section>

      <Section heading="Trial, plans and payment">
        <p>
          A new workspace gets a {TRIAL_DAYS}-day trial with the Starter allowances. When it ends, the workspace becomes
          read-only: everything you have entered stays visible, printable and exportable, and you can subscribe at any
          time to start editing again. Nothing is deleted for non-payment.
        </p>
        <p>
          Subscriptions are billed in advance through Stripe at the price shown when you subscribe. Cancel at any time
          and the plan runs to the end of the period already paid for; we do not pro-rate part-months. Prices exclude VAT
          where applicable.
        </p>
      </Section>

      <Section heading="Your data is yours">
        <p>
          You own everything you put in. We claim no licence over your deals, documents or reports beyond what is needed
          to run the service for you — storing them, processing them at your request, and showing them to the people you
          invite. We do not use your workspace data to train models.
        </p>
        <p>
          Benchmark contribution is off unless an admin turns it on, and contributes ratios only — never client-
          identifying figures. You can take a full export or delete the workspace at any time, including after a trial
          has lapsed.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>
          Do not upload material you have no right to hold, attempt to reach another workspace's data, resell access, or
          use the product to produce a report you know to be misleading. Accounts are per person: sharing one login
          across a team defeats the audit trail that makes a report defensible.
        </p>
      </Section>

      <Section heading="Availability, and what happens when something breaks">
        <p>
          The service is provided without an uptime guarantee. Faults are recorded and visible to workspace admins in
          Settings. If the service is unavailable for a sustained period during a paid term, write to{' '}
          {ENTITY.supportContact} and we will credit the affected time.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          Nothing here limits liability for death or personal injury caused by negligence, for fraud, or for anything
          else that cannot lawfully be limited. Beyond that, the limit of liability and the treatment of indirect loss
          are being settled with our insurers and will be stated here in full before any paid subscription is sold —
          rather than asserted now in a form neither party has checked.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These terms are governed by the law of {ENTITY.governingLaw}, and its courts have exclusive jurisdiction.
        </p>
      </Section>
    </LegalShell>
  );
}
