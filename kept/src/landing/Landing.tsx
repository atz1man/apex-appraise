import { color } from '../tokens';
import { Logo, Wordmark } from '../app/components/Icons';
import { VERIFIED_STORE_COUNT } from '../lib/stores';
import { REVIEWS, SOCIAL_PROOF_IS_PLACEHOLDER, STATS, TICKER_LINES } from './placeholder-content';
import { FinePrintArt, HaulArt, LostReceiptsArt } from './sections/ProblemArt';
import { AppStoreButton, Card, Eyebrow, SectionTitle, WRAP } from './sections/primitives';

const PROBLEMS = [
  { art: <HaulArt />, title: 'The haul is the easy part', body: 'Five shops, one afternoon, five different return clocks — all already ticking.' },
  { art: <LostReceiptsArt />, title: 'Receipts go to die', body: 'Jacket pockets, kitchen drawers, a 9,000-email inbox. Proof of purchase, permanently lost.' },
  { art: <FinePrintArt />, title: 'Nobody reads clause 14b', body: '“30 days from dispatch, unworn, tags attached, exclusions apply.” Kept reads it so you never have to.' },
];

const UPDATES = [
  { store: 'Zara', when: 'updated 2d ago', text: 'Free online returns ended — £1.95 unless you drop off in store. Your deadlines: unchanged, already checked.', emphasised: true },
  { store: 'ASOS', when: 'updated 1w ago', text: 'New 28-day window for “frequent returners”. Kept tells you if that’s you — before you buy the third hoodie.', emphasised: false },
  { store: 'Apple', when: 'updated 3w ago', text: '14-day window confirmed for the iPhone 18 line — warranty clocks added to your receipts automatically.', emphasised: false },
];

const WHY = [
  { n: '01', title: 'Knows the real policies', body: `IKEA’s 365 days, Boots’ 35, Apple’s 14 — verified windows for ${VERIFIED_STORE_COUNT} major UK retailers, plus the gotchas: Zara’s clock starts at dispatch, Uniqlo won’t refund online orders in store.` },
  { n: '02', title: 'Knows your legal rights', body: 'The Consumer Rights Act gives you 30 days to reject faulty goods for a full refund, and online orders carry a 14-day cooling-off by law. Kept shows the legal deadline beside the shop’s own.' },
  { n: '03', title: 'Paste or scan, done', body: 'Paste an order email and Kept reads the store, total and date, and sets the deadline for you. Scanning a paper receipt lands in a later release.' },
  { n: '04', title: 'Warranties too', body: 'Electronics and appliances get a warranty clock alongside the return window, so you know the repair is free before you pay for one.' },
  { n: '05', title: 'Private by design', body: 'Everything lives on your phone. No account, no server, no one reading your purchases. Export a backup anytime.' },
  { n: '06', title: 'Deadline alerts', body: 'A clear countdown on every item, works offline, and a heads-up when something must go back this week.' },
];

const TIERS = [
  { name: 'Monthly', price: '£2.99', suffix: '/mo', lines: ['Unlimited receipts', 'Cancel anytime'] },
  { name: 'Yearly', price: '£16.99', suffix: '/yr', lines: ['Unlimited receipts', 'One missed return pays for it'], featured: true },
  { name: 'Lifetime', price: '£39.99', suffix: ' once', lines: ['Unlimited, forever', 'No subscription'] },
];

export function Landing() {
  return (
    <div style={{ minHeight: '100vh', background: color.cream }}>
      <header style={{ ...WRAP, padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="kept home">
          <Logo size={30} />
          <Wordmark />
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 14.5, fontWeight: 600, flexWrap: 'wrap' }}>
          <a href="#how">How it works</a>
          <a href="#reviews">Reviews</a>
          <a href="#pricing">Pricing</a>
          <a className="k-ink" href="#pricing" style={{ display: 'flex', alignItems: 'center', gap: 8, background: color.ink, color: color.cream, padding: '10px 20px', borderRadius: 999, fontWeight: 700, fontSize: 14 }}>
            App Store
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section style={{ ...WRAP, padding: '48px 28px 72px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 56, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${color.ink}`, borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', marginBottom: 26, flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: color.yellow, flexShrink: 0 }} />
            NO ACCOUNT · NO CLOUD · NO ONE SEES YOUR RECEIPTS
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 'clamp(40px, 6vw, 64px)', fontWeight: 700, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0 }}>
            Stop <span style={{ background: `linear-gradient(transparent 62%, ${color.yellowLight} 62%)` }}>donating money</span> to shops.
          </h1>
          <p style={{ fontSize: 17.5, lineHeight: 1.6, color: color.body, maxWidth: 520, margin: '24px 0 0' }}>
            Kept remembers every receipt, knows each shop’s real return policy and your legal rights — and pings you before either clock runs out.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 32, flexWrap: 'wrap' }}>
            <AppStoreButton />
            <div style={{ fontSize: 13.5, color: color.muted, lineHeight: 1.5 }}>
              Free for your first 10 receipts.
              <br />
              No account needed.
            </div>
          </div>
          <div style={{ marginTop: 22, fontFamily: "'Space Grotesk', monospace", fontSize: 13, fontWeight: 600, letterSpacing: '1.5px', color: color.amber }}>
            WORK HARD · PLAY HARD
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 10 }}>
            <span className="k-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: color.yellow }} />
            <span style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', color: color.muted }}>
              LIVE DEMO — GO ON, TAP IT
            </span>
          </div>
          {/*
            The real app, not a video: it is the same build served from /app/,
            so the demo cannot drift from the product the way a recording does.
            Onboarding is skipped for the embed via the query flag.
          */}
          <div style={{ borderRadius: 32, overflow: 'hidden', border: `1.5px solid ${color.ink}`, boxShadow: `0 12px 32px rgba(23,20,16,0.22)`, background: color.cream, margin: '0 auto', maxWidth: 402 }}>
            <iframe
              src="/app/?embed=1"
              title="kept — live app demo"
              loading="lazy"
              style={{ width: '100%', height: 812, border: 0, display: 'block' }}
            />
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div style={{ background: color.ink, padding: '14px 0', overflow: 'hidden', whiteSpace: 'nowrap' }} aria-hidden="true">
        <div className="k-ticker" style={{ display: 'inline-flex', gap: 48, fontFamily: "'Space Grotesk', monospace", fontSize: 13, fontWeight: 600, color: color.yellow }}>
          {[...TICKER_LINES, ...TICKER_LINES].map((line, i) => (
            <span key={i} style={{ display: 'inline-flex', gap: 48 }}>
              <span>{line}</span>
              <span style={{ color: color.onInkFaint }}>◆</span>
            </span>
          ))}
        </div>
      </div>

      {/* The problem */}
      <section style={{ ...WRAP, padding: '80px 28px 0' }}>
        <Eyebrow>THE PROBLEM</Eyebrow>
        <SectionTitle>You shop in seconds. The fine print takes hours.</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, margin: '38px 0 80px' }}>
          {PROBLEMS.map((p) => (
            <Card key={p.title} style={{ overflow: 'hidden' }}>
              <div style={{ height: 220 }}>{p.art}</div>
              <div style={{ padding: '20px 22px' }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{p.title}</div>
                <div style={{ fontSize: 14, color: color.body, lineHeight: 1.6, marginTop: 6 }}>{p.body}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Policy watch */}
      <section style={{ ...WRAP }}>
        <Eyebrow>LIVE POLICY WATCH</Eyebrow>
        <SectionTitle>Shops rewrite the rules quietly. Your app hears about it first.</SectionTitle>
        <p style={{ fontSize: 16, color: color.muted, margin: '14px 0 0', maxWidth: 560, lineHeight: 1.6 }}>
          Retailers change return windows all the time — and never send a memo. Kept ships verified policy updates
          the day they change, and checks every receipt you hold against them. A purchase keeps the terms it was made
          under; you just find out when the shop moves the goalposts for the next one.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, margin: '38px 0 80px' }}>
          {UPDATES.map((u) => (
            <Card key={u.store} emphasised={u.emphasised} style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{u.store}</span>
                <span style={{ fontSize: 11, fontWeight: 700, background: color.yellowLight, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{u.when}</span>
              </div>
              <div style={{ fontSize: 14, color: color.body, lineHeight: 1.6, marginTop: 12 }}>{u.text}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* Social proof */}
      <section id="reviews" style={{ background: color.creamAlt, borderTop: `1.5px solid ${color.borderHair}`, borderBottom: `1.5px solid ${color.borderHair}`, padding: '80px 28px' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, textAlign: 'center', marginBottom: SOCIAL_PROOF_IS_PLACEHOLDER ? 20 : 56 }}>
            {STATS.map((s) => (
              <div key={s.label}>
                <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 'clamp(34px, 4vw, 46px)', fontWeight: 700, letterSpacing: '-2px', color: color.amber }}>{s.value}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: color.muted, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {SOCIAL_PROOF_IS_PLACEHOLDER && (
            /*
             * Deliberately visible. These figures and reviews are the
             * handoff's illustrative copy, not measurements or real
             * customers — and a page that presents them as either is
             * misleading the people reading it. The notice comes out when
             * `SOCIAL_PROOF_IS_PLACEHOLDER` does, which is the same edit that
             * requires putting substantiated numbers in their place.
             */
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', margin: '0 auto 44px',
                maxWidth: 720, padding: '10px 16px', border: `1.5px dashed ${color.borderSoft}`, borderRadius: 999,
                fontSize: 12.5, fontWeight: 600, color: color.muted, textAlign: 'center',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: color.danger, flexShrink: 0 }} />
              Placeholder: these figures and reviews are illustrative pre-launch copy, not real customers or measured results.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            {REVIEWS.map((r) => (
              <Card key={r.who} style={{ padding: 26 }}>
                {/* Amber, not the brand yellow: five yellow stars on white measured
                    1.79:1, and a rating nobody can see is not a rating. */}
                <div style={{ color: color.amber, fontSize: 15, letterSpacing: '2px' }} aria-label="Five stars">★★★★★</div>
                <div style={{ fontSize: 15, lineHeight: 1.6, marginTop: 12, fontWeight: 500 }}>“{r.quote}”</div>
                <div style={{ fontSize: 13, color: color.muted, marginTop: 14, fontWeight: 600 }}>{r.who}</div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Why kept */}
      <section id="how" style={{ background: color.ink, color: color.cream, padding: '80px 28px' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto' }}>
          <Eyebrow onInk>WHY KEPT</Eyebrow>
          <SectionTitle maxWidth={640}>The shop’s clock, the law’s clock, and yours — on one screen.</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 1, background: color.onInkBorder, border: `1px solid ${color.onInkBorder}`, borderRadius: 20, overflow: 'hidden', marginTop: 44 }}>
            {WHY.map((w) => (
              <div key={w.n} style={{ background: color.ink, padding: '30px 28px' }}>
                <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 22, color: color.yellow }}>{w.n}</div>
                <div style={{ fontWeight: 700, fontSize: 17, marginTop: 14 }}>{w.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: color.fainter, marginTop: 8 }}>{w.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ ...WRAP, padding: '80px 28px' }}>
        <div style={{ textAlign: 'center' }}>
          <Eyebrow>PRICING</Eyebrow>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 'clamp(30px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.03em', margin: '14px 0 0' }}>
            Free for your first 10 receipts.
          </h2>
          <p style={{ fontSize: 16, color: color.muted, margin: '12px 0 0' }}>Pro when it’s earning its keep.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, maxWidth: 880, margin: '44px auto 0' }}>
          {TIERS.map((t) =>
            t.featured ? (
              <div key={t.name} style={{ background: color.ink, color: color.cream, borderRadius: 22, padding: '30px 26px', position: 'relative', boxShadow: `6px 6px 0 ${color.yellow}` }}>
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: color.yellow, color: color.ink, fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 999, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                  BEST VALUE
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: color.fainter }}>{t.name}</div>
                <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 36, fontWeight: 700, marginTop: 10, color: color.yellow }}>
                  {t.price}
                  <span style={{ fontSize: 15, color: color.fainter, fontWeight: 500 }}>{t.suffix}</span>
                </div>
                <div style={{ fontSize: 14, color: color.onInkBody, marginTop: 16, lineHeight: 1.9 }}>
                  {t.lines.map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div key={t.name} style={{ background: color.white, border: `1.5px solid ${color.borderSoft}`, borderRadius: 22, padding: '30px 26px' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: color.muted }}>{t.name}</div>
                <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 36, fontWeight: 700, marginTop: 10 }}>
                  {t.price}
                  <span style={{ fontSize: 15, color: color.muted, fontWeight: 500 }}>{t.suffix}</span>
                </div>
                <div style={{ fontSize: 14, color: color.body, marginTop: 16, lineHeight: 1.9 }}>
                  {t.lines.map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 52 }}>
          <AppStoreButton large />
        </div>
      </section>

      <footer style={{ borderTop: '1.5px solid rgba(23,20,16,0.1)', padding: 28 }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: color.muted, gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Logo size={20} />
            <Wordmark size={16} />
          </div>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 600, color: color.amber }}>work hard · play hard</div>
          <div>
            local-first receipt &amp; return tracking · <a href="#how">how it works</a> · <a href="#pricing">pricing</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
