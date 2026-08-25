import { Link } from 'react-router-dom';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_MEANING, WEBHOOK_RETRY_SCHEDULE_SECONDS } from '@apex/types/api';
import { EyebrowTitle, TopBar } from '../components/ui';

/**
 * The public API, documented.
 *
 * `/api/v1` has always answered a discovery document naming this page — and the
 * page did not exist, at a hardcoded fly.dev hostname that was wrong for every
 * deployment that is not ours. So the first thing an integrator does after
 * finding the API was follow a link to nothing.
 *
 * Written from the same constants the server uses where there are any: the
 * events come from @apex/types/api, which is also what createWebhook validates
 * against, and apps/api/test/api-docs.test.ts holds the endpoint table against
 * the routes actually registered. A documentation page that can drift is a
 * documentation page that will.
 */

const ENDPOINTS: Array<{ method: string; path: string; what: string; query?: string }> = [
  { method: 'GET', path: '/api/v1', what: 'This surface, described. The only route that needs no key.' },
  { method: 'GET', path: '/api/v1/deals', what: 'Deals in your workspace, newest first.', query: 'limit, cursor, stage' },
  { method: 'GET', path: '/api/v1/deals/:id', what: 'One deal with its current appraisal.' },
  { method: 'GET', path: '/api/v1/exposure', what: 'Portfolio exposure, concentration and covenant headroom.' },
  { method: 'GET', path: '/api/v1/webhooks', what: 'The endpoints this workspace is notified on.' },
];

const ERRORS: Array<[string, string, string]> = [
  ['401', 'unauthorised', 'No key, or one that is not valid. Carries a WWW-Authenticate header.'],
  ['402', 'plan_required', 'The key is fine; the subscription does not include the API. It works again when the plan does.'],
  ['403', 'forbidden', 'The key does not carry the scope this route needs.'],
  ['404', 'not_found', 'No such record — or one that is not yours. Deliberately the same answer for both.'],
];

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold tracking-[-0.3px]">{heading}</h2>
      <div className="mt-2 text-[13px] leading-[1.7] text-ink-2 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="fig text-[12px] rounded-[5px] bg-sunken px-1.5 py-0.5">{children}</code>
);

const Block = ({ children }: { children: string }) => (
  <pre className="fig overflow-x-auto rounded-[10px] border border-border-std bg-sunken px-3.5 py-3 text-[12px] leading-[1.6] text-ink-2">
    {children}
  </pre>
);

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-frame">
      <TopBar crumb={<Link to="/welcome" className="text-[13px] font-medium text-ink-2 hover:text-ink">Apex Appraise</Link>} />
      <div className="mx-auto max-w-[760px] px-6 py-10">
        <EyebrowTitle
          eyebrow="Developers"
          title="Public API"
          sub="Read your workspace from your own systems, and be told when something happens in it."
        />

        <div className="mt-7 flex flex-col gap-7">
          <Section heading="Authentication">
            <p className="m-0">
              A bearer token on every request except the discovery document. Create one under Settings → API keys; it is
              shown once and stored only as a hash, so nobody, including us, can produce it a second time.
            </p>
            <Block>{`curl https://your-apex-host/api/v1/deals \\
  -H "Authorization: Bearer apex_live_..."`}</Block>
            <p className="m-0">
              A key belongs to the workspace rather than to a person, so an integration keeps working after whoever set it
              up has moved on. Keys are read-only today: every route below is a <Code>GET</Code>, and none asks for a write
              scope.
            </p>
          </Section>

          <Section heading="Endpoints">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <thead>
                  <tr className="text-left text-ink-3">
                    <th className="py-1.5 pr-3 font-semibold">Method</th>
                    <th className="py-1.5 pr-3 font-semibold">Path</th>
                    <th className="py-1.5 font-semibold">What it returns</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.path} className="border-t border-border-faint align-top">
                      <td className="py-2 pr-3"><Code>{e.method}</Code></td>
                      <td className="py-2 pr-3"><Code>{e.path}</Code></td>
                      <td className="py-2 text-ink-2">
                        {e.what}
                        {e.query && <div className="mt-1 text-[11.5px] text-ink-3">Query: {e.query}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section heading="Conventions">
            <p className="m-0">
              <strong className="font-semibold text-ink">Money is in pounds, to the penny.</strong> It is stored as integer
              pence and converted once, on the way out, so nothing is lost to rounding in transit.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink">Pagination is by cursor, not offset.</strong> Pass the{' '}
              <Code>nextCursor</Code> from a response as <Code>cursor</Code> on the next request. A page cannot shift under
              you while you are reading it, which an offset cannot promise.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink">A deal that is not yours answers 404</strong>, the same as one
              that does not exist. Telling the two apart would confirm that a record exists in somebody else's workspace.
            </p>
            <p className="m-0">
              <strong className="font-semibold text-ink">Every figure is computed by the same engine the screens use.</strong>{' '}
              An API carrying its own arithmetic would eventually disagree with the report a client was sent, and the
              client would be right to believe whichever one was worse.
            </p>
          </Section>

          <Section heading="Errors">
            <p className="m-0">One shape, always:</p>
            <Block>{`{ "error": { "code": "plan_required", "message": "…" } }`}</Block>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <tbody>
                  {ERRORS.map(([status, code, meaning]) => (
                    <tr key={code} className="border-t border-border-faint align-top">
                      <td className="py-2 pr-3"><Code>{status}</Code></td>
                      <td className="py-2 pr-3"><Code>{code}</Code></td>
                      <td className="py-2 text-ink-2">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section heading="Webhooks">
            <p className="m-0">
              Add an endpoint under Settings → Webhooks and choose what to hear about. Payloads carry deal figures, so the
              URL must be <Code>https</Code>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <tbody>
                  {WEBHOOK_EVENTS.map((event) => (
                    <tr key={event} className="border-t border-border-faint align-top">
                      <td className="py-2 pr-3 whitespace-nowrap"><Code>{event}</Code></td>
                      <td className="py-2 text-ink-2">{WEBHOOK_EVENT_MEANING[event]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0">Each delivery carries:</p>
            <Block>{`apex-event: appraisal.approved
apex-delivery: <id, unique per attempt-set>
apex-signature: t=<unix seconds>,v1=<hex>`}</Block>
            <p className="m-0">
              <strong className="font-semibold text-ink">Verify it.</strong> <Code>v1</Code> is HMAC-SHA256 of the string{' '}
              <Code>{'<t>.<body>'}</Code> — the timestamp, a full stop, then the raw request body — keyed with the endpoint
              secret shown when you added it. Sign the timestamp together with the body, not the body alone: a signature
              over the body by itself makes every delivery you have ever received valid for ever, and a captured one
              replayable months later. Reject anything whose <Code>t</Code> is not recent.
            </p>
            <Block>{`const signed = \`\${t}.\${rawBody}\`;
const expected = createHmac('sha256', secret).update(signed).digest('hex');
// compare with timingSafeEqual, not ===`}</Block>
            <p className="m-0">
              A delivery is retried {WEBHOOK_RETRY_SCHEDULE_SECONDS.length} times in all, at{' '}
              {WEBHOOK_RETRY_SCHEDULE_SECONDS.map((s) => (s === 0 ? 'once' : s < 60 ? `${s}s` : `${s / 60}m`)).join(', ')}{' '}
              from the first attempt. Any 2xx is success. Recent attempts and their response codes are listed under
              Settings → Webhooks, so a failing integration can be diagnosed without asking us.
            </p>
            <p className="m-0">
              Deliveries are queued, not sent inline — the action that caused one never waits on your server, and never
              fails because your server is down.
            </p>
          </Section>

          <Section heading="Availability">
            <p className="m-0">
              The API and webhooks are included from Enterprise. On any other plan an existing key answers{' '}
              <Code>402</Code> and endpoints stop receiving; nothing is deleted, and both resume when the plan does.
            </p>
          </Section>
        </div>

        <div className="mt-10 pt-5 border-t border-border-std text-[12px] text-ink-3 leading-[1.6]">
          <div className="flex gap-4">
            <Link className="font-medium text-ink-2 hover:text-ink" to="/welcome">Home</Link>
            <Link className="font-medium text-ink-2 hover:text-ink" to="/privacy">Privacy</Link>
            <Link className="font-medium text-ink-2 hover:text-ink" to="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
