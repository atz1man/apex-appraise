import { color, radius, shadow } from '../../tokens';
import { addDays, fmtDate, fmtDateNear } from '../../lib/dates';
import { money, sumPence } from '../../lib/money';
import { bucket, derive, timelineDots } from '../../lib/receipts';
import { heroCount, urgency } from '../../lib/urgency';
import type { Receipt } from '../../lib/types';
import { ArrowRight, Logo, LogoDashed, LogoWatermark, Tick, Wordmark } from '../components/Icons';
import { Pressable } from '../components/Pressable';
import { ReceiptRow } from '../components/ReceiptRow';

interface Props {
  receipts: Receipt[];
  today: Date;
  urgentDays: number;
  policyAlert: string | null;
  /** Retailers with a live policy change, decided once in App and shared by
      the banner, the tab dot and every row badge so they cannot disagree. */
  changedStores: Set<string>;
  onOpen: (id: string) => void;
  onReturn: (id: string) => void;
  onAdd: () => void;
  onWatch: () => void;
}

const sectionLabel = (c: string) => ({
  fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: c, margin: '20px 4px 10px',
});

export function Home({ receipts, today, urgentDays, policyAlert, changedStores, onOpen, onReturn, onAdd, onWatch }: Props) {
  const { urgent, later, returned } = bucket(receipts, today, urgentDays);
  const active = [...urgent, ...later];
  const next = active[0];
  const stillReturnable = sumPence(active.map((r) => r.amount));
  const keptBack = sumPence(returned.map((r) => r.amount));
  const dots = timelineDots(receipts, today);
  const empty = receipts.length === 0;
  const allDone = active.length === 0 && returned.length > 0;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <header className="k-fade" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 2px 16px' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 9, margin: 0, fontWeight: 400, minWidth: 0 }}>
          <Logo size={28} />
          <span>
            <Wordmark />
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.8px', color: color.muted, marginTop: 3 }}>
              RETURN DEADLINES, WATCHED
            </span>
          </span>
        </h1>
        {/* nowrap + no shrink: at 320px this was breaking to "ON-" / "DEVICE".
            The masthead beside it wraps instead, which it does gracefully. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: color.white, border: `1.5px solid ${color.ink}`, borderRadius: 999, padding: '6px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: color.yellow }} />
          ON-DEVICE
        </div>
      </header>

      {next && (
        <HeroCard
          receipt={next}
          today={today}
          stillReturnable={money(stillReturnable)}
          keptBack={money(keptBack)}
          onOpen={() => onOpen(next.id)}
        />
      )}

      {policyAlert && (
        <Pressable
          className="k-banner k-fade"
          onClick={onWatch}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, background: color.yellowLight,
            border: `1.5px solid ${color.ink}`, borderRadius: 16, padding: '13px 15px', marginTop: 12,
          }}
        >
          <span className="k-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: color.ink, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, lineHeight: 1.35, textAlign: 'left' }}>{policyAlert}</span>
          <span style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 13, fontWeight: 700 }}>→</span>
        </Pressable>
      )}

      {next && (
        <section className="k-fade" style={{ margin: '18px 2px 0' }} aria-label="Deadlines in the next 30 days">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: color.muted, letterSpacing: '0.5px' }}>
            <span>NEXT 30 DAYS</span>
            <span style={{ fontFamily: "'Space Grotesk', monospace" }}>today → {fmtDate(addDays(today, 30))}</span>
          </div>
          <div style={{ position: 'relative', height: 22, marginTop: 8 }}>
            <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 2, borderRadius: 2, background: color.rail }} />
            {dots.map((d, i) => (
              <div
                key={`${d.store}-${i}`}
                title={`${d.store} · ${d.daysLeft} days left`}
                style={{
                  position: 'absolute', top: 4, left: `${d.left}%`, width: 14, height: 14,
                  marginLeft: -7, borderRadius: 999, background: color.cream,
                  border: `2.5px solid ${urgency(d.daysLeft, urgentDays).dot}`,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {empty && <EmptyState onAdd={onAdd} />}

      {allDone && (
        <div style={{ textAlign: 'center', padding: '36px 24px 8px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: color.yellowLight, border: `1.5px solid ${color.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Tick size={26} />
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>All squared away</div>
          <div style={{ fontSize: 14, color: color.muted, lineHeight: 1.6, marginTop: 8 }}>
            Every return made it back in time. {money(keptBack)} recovered — not bad.
          </div>
        </div>
      )}

      {urgent.length > 0 && (
        <>
          <h2 style={sectionLabel(color.danger)}>GO NOW OR LOSE IT</h2>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, margin: 0, padding: 0 }}>
            {urgent.map((r) => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                urgency={urgency(derive(r, today).daysLeft, urgentDays)}
                emphasised
                policyChanged={changedStores.has(r.store)}
                onOpen={() => onOpen(r.id)}
                onReturn={() => onReturn(r.id)}
              />
            ))}
          </ul>
        </>
      )}

      {later.length > 0 && (
        <>
          <h2 style={sectionLabel(color.muted)}>CHILL, THERE’S TIME</h2>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, margin: 0, padding: 0 }}>
            {later.map((r) => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                urgency={urgency(derive(r, today).daysLeft, urgentDays)}
                emphasised={false}
                policyChanged={changedStores.has(r.store)}
                onOpen={() => onOpen(r.id)}
                onReturn={() => onReturn(r.id)}
              />
            ))}
          </ul>
        </>
      )}

      {returned.length > 0 && (
        <>
          <h2 style={sectionLabel(color.muted)}>MONEY BACK ✓</h2>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 9, margin: 0, padding: 0 }}>
            {returned.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 15, background: color.creamAlt, border: '1.5px solid rgba(23,20,16,0.06)', borderRadius: radius.card, listStyle: 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: color.yellowLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Tick />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, textDecoration: 'line-through', color: color.muted }}>{r.store}</div>
                  <div style={{ fontSize: 12, color: color.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.item}</div>
                </div>
                <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 15, fontWeight: 700, color: color.amber }}>{money(r.amount)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function HeroCard({ receipt, today, stillReturnable, keptBack, onOpen }: {
  receipt: Receipt; today: Date; stillReturnable: string; keptBack: string; onOpen: () => void;
}) {
  const d = derive(receipt, today);
  const { count, word } = heroCount(d.daysLeft);
  const accent = d.daysLeft <= 3 ? color.onInkDanger : color.yellow;

  return (
    <Pressable
      className="k-fade"
      onClick={onOpen}
      style={{
        background: color.ink, borderRadius: radius.hero, padding: '22px 20px 20px',
        position: 'relative', overflow: 'hidden', color: color.cream, boxShadow: shadow.lift, textAlign: 'left',
      }}
    >
      <LogoWatermark style={{ position: 'absolute', top: -28, right: -34, transform: 'rotate(12deg)', opacity: 0.14 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="k-pulse" style={{ width: 7, height: 7, borderRadius: 999, background: accent }} />
        <span style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 11, letterSpacing: '2px', color: color.faint, fontWeight: 600 }}>
          NEXT WINDOW TO CLOSE
        </span>
      </div>
      {/* No wrap: the count and the sentence share a baseline, and the
          sentence wraps inside its own column rather than dropping below a
          44px number and leaving it stranded on a line of its own. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 12 }}>
        <span style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 44, fontWeight: 700, letterSpacing: '-1.8px', color: accent, lineHeight: 1, flexShrink: 0 }}>
          {count}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: color.onInkBody }}>
          {word} {receipt.item.toLowerCase()}
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: color.faint, marginTop: 8 }}>
        {receipt.store} · {money(receipt.amount)} back if it goes back by {fmtDateNear(d.deadline, today)}
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '11px 20px', background: color.yellow, color: color.ink, borderRadius: 999, fontWeight: 700, fontSize: 13.5 }}>
        See what to do <ArrowRight />
      </div>
      <div style={{ borderTop: `1.5px dashed ${color.onInkDash}`, marginTop: 18, paddingTop: 12, display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: "'Space Grotesk', monospace", fontSize: 12.5 }}>
        <span style={{ color: color.faint }}>{stillReturnable} still returnable</span>
        <span style={{ color: color.yellow, fontWeight: 600 }}>{keptBack} kept back</span>
      </div>
    </Pressable>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 24px 30px' }}>
      <LogoDashed />
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px' }}>Nothing tracked yet</div>
      <div style={{ fontSize: 14, color: color.muted, lineHeight: 1.6, marginTop: 8 }}>
        Bought something this week? The return clock is already ticking. Add your first receipt and kept takes it from there.
      </div>
      <Pressable
        className="k-cta-yellow"
        onClick={onAdd}
        style={{
          display: 'inline-block', width: 'auto', marginTop: 18, padding: '14px 28px', background: color.yellow,
          border: `1.5px solid ${color.ink}`, borderRadius: 999, fontWeight: 700, fontSize: 14, boxShadow: shadow.hard,
        }}
      >
        Add your first receipt
      </Pressable>
    </div>
  );
}
