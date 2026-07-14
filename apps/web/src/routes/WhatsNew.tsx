import { Link } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { Button, EyebrowTitle, StatusChip, TopBar } from '../components/ui';

// Public changelog — no auth, no data fetching. Newest first.

type Tag = 'Platform' | 'AI' | 'Design';

const TAG_TONE: Record<Tag, StatusKey> = {
  Platform: 'blue',
  AI: 'purple',
  Design: 'green',
};

type Entry = { date: string; title: string; body: string; tag: Tag };

const ENTRIES: Entry[] = [
  {
    date: '2026-07-14',
    title: 'Live on the web',
    body: 'Apex Appraise is now hosted: sign in from anywhere, nothing to install.',
    tag: 'Platform',
  },
  {
    date: '2026-07-14',
    title: 'AI-drafted Red Book narratives',
    body: 'Market commentary, valuation rationale and risk commentary drafted from the deal’s actual figures. The valuer reviews, the report ships it.',
    tag: 'AI',
  },
  {
    date: '2026-07-14',
    title: 'Ask the workfile',
    body: 'Question in, cited answer out — straight from the deal’s documents.',
    tag: 'AI',
  },
  {
    date: '2026-07-14',
    title: 'Scenario risk view',
    body: 'One click compares scheme options’ risk profiles with real engine figures.',
    tag: 'AI',
  },
  {
    date: '2026-07-14',
    title: 'Always-fresh demo',
    body: 'The public demo resets itself nightly.',
    tag: 'Platform',
  },
  {
    date: '2026-07-13',
    title: 'Apple-grade visual pass + dark mode',
    body: 'Refined type scale, frosted surfaces, a full dark theme and Lighthouse 100 accessibility.',
    tag: 'Design',
  },
];

/** "2026-07-14" → "14 JUL 2026" (rendered via the mono micro-label class). */
const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function WhatsNew() {
  return (
    <div className="min-h-screen">
      <TopBar
        crumb="What's new"
        right={
          <Button to="/welcome" variant="secondary">
            Apex Appraise home
          </Button>
        }
      />
      <main className="max-w-[720px] mx-auto px-6 pb-16">
        <div className="mt-8">
          <EyebrowTitle
            eyebrow="Changelog"
            title="What's new"
            sub="Everything we've shipped recently, newest first."
          />
        </div>

        <div className="mt-7 flex flex-col gap-3.5">
          {ENTRIES.map((e) => (
            <article key={e.title} className="bg-surface rounded-card shadow-rest p-5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="label-mono text-ink-3">{dateLabel(e.date)}</span>
                <StatusChip status={TAG_TONE[e.tag]} label={e.tag} />
              </div>
              <h2 className="mt-2 text-[16px] font-semibold tracking-[-0.3px]">{e.title}</h2>
              <p className="mt-1 text-[13.5px] text-ink-2 leading-relaxed">{e.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-9 text-[12.5px] text-ink-3">
          Want a closer look?{' '}
          <Link to="/welcome" className="font-medium text-ink-2 hover:text-ink underline underline-offset-2">
            Visit the site
          </Link>{' '}
          or{' '}
          <Link to="/login" className="font-medium text-ink-2 hover:text-ink underline underline-offset-2">
            sign in
          </Link>
          .
        </div>
      </main>
    </div>
  );
}
