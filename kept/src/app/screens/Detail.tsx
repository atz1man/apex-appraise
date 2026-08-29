import { useState } from 'react';
import { color, font, radius, shadow } from '../../tokens';
import { fmtDateLong, fmtDatesTogether, fromISODate } from '../../lib/dates';
import { legalRights } from '../../lib/legal';
import { money } from '../../lib/money';
import { derive } from '../../lib/receipts';
import type { Receipt } from '../../lib/types';
import { findStore } from '../../lib/stores';
import { urgency } from '../../lib/urgency';
import { ChevronLeft, Warning } from '../components/Icons';
import { Pressable } from '../components/Pressable';

/** 2π × 40, the circumference of the ring the countdown draws on. */
const RING_CIRCUMFERENCE = 251.3;

interface Props {
  receipt: Receipt;
  today: Date;
  urgentDays: number;
  onBack: () => void;
  onEdit: () => void;
  onReturn: () => void;
  onUnreturn: () => void;
  onDelete: () => void;
}

const cardLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: color.muted } as const;

export function Detail({ receipt, today, urgentDays, onBack, onEdit, onReturn, onUnreturn, onDelete }: Props) {
  const [legalOpen, setLegalOpen] = useState(true);
  const d = derive(receipt, today);
  const u = urgency(d.daysLeft, urgentDays);
  const rights = legalRights(receipt, today, !d.expired);

  /*
   * The ring shows time REMAINING, so it empties as the window closes — the
   * arc a glance reads as "how much is left". Clamped at both ends: a receipt
   * past its deadline draws nothing rather than sweeping backwards.
   *
   * Counted INCLUSIVE of today, which it was not. `daysLeft` is 0 on the last
   * day the thing can go back, so the arc was zero-length on exactly the day
   * the ring matters most: the screen read "0 days left · RETURN BY 29 Aug"
   * beside an empty grey track, with no red anywhere on it. There is still a
   * day left on the last day, and the ring now says so — thinly.
   */
  const remaining = Math.max(0, Math.min(1, (d.daysLeft + 1) / receipt.windowDays));
  const ringOffset = (RING_CIRCUMFERENCE * (1 - remaining)).toFixed(1);
  const ringColor = d.expired ? color.onInkDanger : u.level === 'critical' ? color.onInkDanger : u.level === 'soon' ? color.yellow : color.cream;

  const dispatchDiffers = receipt.windowStartsOn && receipt.windowStartsOn !== receipt.purchasedOn;
  // The table, not the receipt: which clock a shop runs is not something a
  // receipt records, and unlike the WINDOW it is not a term that changes under
  // a purchase — a shop counts from the till, the warehouse or the doormat,
  // and it does not switch.
  const clockStart = findStore(receipt.store)?.clockStart ?? 'purchase';

  // Rendered as a pair: a year on the deadline and none on the purchase is
  // what let "RETURN BY 15 Feb 2027" sit above "bought 15 Feb". See
  // fmtDatesTogether.
  const [deadlineText, boughtText, returnedText] = fmtDatesTogether(
    [d.deadline, fromISODate(receipt.purchasedOn), ...(receipt.returnedOn ? [fromISODate(receipt.returnedOn)] : [])],
    today,
  );

  return (
    <div className="k-fade" style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '8px 0 16px' }}>
        <Pressable
          className="k-row-white"
          onClick={onBack}
          style={{
            display: 'inline-flex', width: 'auto', alignItems: 'center', gap: 6, padding: '9px 15px 9px 11px',
            background: color.white, border: `1.5px solid ${color.ink}`, borderRadius: 999,
            fontSize: 13, fontWeight: 700,
          }}
        >
          <ChevronLeft />
          Back
        </Pressable>
        <Pressable
          className="k-row-white"
          onClick={onEdit}
          style={{
            display: 'inline-flex', width: 'auto', alignItems: 'center', gap: 6, padding: '9px 16px',
            background: color.white, border: `1.5px solid ${color.border}`, borderRadius: 999,
            fontSize: 13, fontWeight: 700,
          }}
        >
          Edit
        </Pressable>
      </div>

      <div style={{ background: color.ink, color: color.cream, borderRadius: radius.hero, padding: '22px 20px', boxShadow: shadow.lift }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 tabIndex={-1} style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>{receipt.store}</h1>
            <div style={{ fontSize: 13, color: color.faint, marginTop: 3 }}>{receipt.item}</div>
          </div>
          <div style={{ fontFamily: font.figures, fontSize: 26, fontWeight: 700, color: color.yellow }}>
            {money(receipt.amount)}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 20 }}>
          <div style={{ position: 'relative', width: 92, height: 92, flexShrink: 0 }}>
            <svg width="92" height="92" viewBox="0 0 92 92" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
              <circle cx="46" cy="46" r="40" fill="none" stroke={color.onInkBorder} strokeWidth="7" />
              <circle
                cx="46" cy="46" r="40" fill="none" stroke={ringColor} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={ringOffset}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              {/* Coloured like the count on the home hero, which has always
                  done this. Here the ring's stroke was the only urgency
                  signal on the screen, and on the last day it was a hairline. */}
              <div style={{ fontFamily: font.figures, fontSize: d.expired ? 15 : 22, fontWeight: 700, lineHeight: 1, color: ringColor }}>
                {d.expired ? 'closed' : d.daysLeft}
              </div>
              {!d.expired && <div style={{ fontSize: 10, color: color.faint, marginTop: 2 }}>days left</div>}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '1.6px', color: color.faint, fontWeight: 600 }}>
              {d.expired ? 'WINDOW CLOSED' : 'RETURN BY'}
            </div>
            <div style={{ fontFamily: font.figures, fontSize: 24, fontWeight: 700, marginTop: 4 }}>
              {deadlineText}
            </div>
            <div style={{ fontSize: 12, color: color.faint, marginTop: 6 }}>
              {d.daysUsed} of {receipt.windowDays} days used · bought {boughtText}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: color.white, border: `1.5px solid ${color.border}`, borderRadius: radius.cardLg, marginTop: 12 }}>
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={cardLabel}>STORE POLICY</div>
          <div style={{ fontSize: 14, marginTop: 5, lineHeight: 1.5, color: color.bodyStrong }}>{receipt.policy}</div>
          {dispatchDiffers && (
            <div style={{ fontSize: 12.5, marginTop: 8, color: color.muted }}>
              Clock started {fmtDateLong(fromISODate(receipt.windowStartsOn!))} ({clockStart === 'dispatch' ? 'dispatch' : 'delivery'}), not the day you ordered.
            </div>
          )}
          {/* The other half of the same fact, and the one that was silent.
              This shop counts from dispatch and this receipt does not know
              when that was — the paste did not say — so the app is counting
              from the order, which is earlier and therefore cautious. It was
              presenting that as the deadline rather than as a floor, and a
              floor shown as a fact says "window closed" on a day the shop
              would still take the thing back. Same hedge the statutory
              clocks make when the arrival date is unknown, pointing the
              other way. */}
          {clockStart !== 'purchase' && !receipt.windowStartsOn && (
            <div style={{ fontSize: 12.5, marginTop: 8, color: color.muted }}>
              {receipt.store} counts from {clockStart === 'dispatch' ? 'dispatch' : 'the day it arrives'}, not from your
              order — and this receipt does not say when that was, so the date above is the earliest it can be, never
              the latest.
            </div>
          )}
        </div>

        <div style={{ borderTop: `1.5px solid ${color.borderHair}`, padding: '15px 18px' }}>
          <Pressable
            onClick={() => setLegalOpen((v) => !v)}
            aria-expanded={legalOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', minWidth: 0 }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: color.amber }}>
              {rights.length > 1 ? 'YOUR LEGAL RIGHTS' : 'YOUR LEGAL RIGHT'}
            </span>
            {/* One chip per right. A distance purchase carries two, and which
                statute each comes from is the part someone repeats at a
                counter — see legal.ts for why they are not alternatives. */}
            {rights.map((right) => (
              <span
                key={right.chip}
                style={{ fontSize: 10, fontWeight: 700, background: color.yellowLight, padding: '2px 8px', borderRadius: 999 }}
              >
                {right.chip}
              </span>
            ))}
            <svg width="10" height="7" viewBox="0 0 10 7" style={{ marginLeft: 'auto', flexShrink: 0, transform: `rotate(${legalOpen ? 180 : 0}deg)`, transition: 'transform .2s' }} aria-hidden="true">
              <path d="M1 1.5l4 4 4-4" fill="none" stroke={color.muted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Pressable>
          {legalOpen &&
            rights.map((right) => (
              <div key={right.chip} style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5, color: color.bodyStrong }}>
                {right.body}
              </div>
            ))}
        </div>

        {receipt.warranty && (
          <div style={{ borderTop: `1.5px solid ${color.borderHair}`, padding: '15px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <div style={cardLabel}>WARRANTY</div>
              {/* The clock, not a sentence about one. The question a warranty
                  has to answer is "is the repair free today?", and prose could
                  not answer it. */}
              {d.warranty && d.warranty.months > 0 && (
                <div
                  style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                    background: d.warranty.expired ? color.creamAlt : color.yellowLight,
                    color: d.warranty.expired ? color.body : color.ink,
                  }}
                >
                  {d.warranty.expired ? 'expired' : `${d.warranty.label} left`}
                </div>
              )}
            </div>
            {d.warranty && d.warranty.months > 0 && (
              <div style={{ fontSize: 14, marginTop: 5, color: color.bodyStrong }}>
                {d.warranty.expired
                  ? `Cover ran out on ${fmtDateLong(d.warranty.ends)}.`
                  : `Repairs should be free until ${fmtDateLong(d.warranty.ends)}.`}
              </div>
            )}
            {receipt.warranty.note && (
              <div style={{ fontSize: 13, marginTop: 4, color: color.muted }}>{receipt.warranty.note}</div>
            )}
          </div>
        )}
      </div>

      {receipt.gotcha && (
        <div style={{ display: 'flex', gap: 10, background: color.yellowLight, border: `1.5px solid ${color.ink}`, borderRadius: 16, padding: '14px 16px', marginTop: 12 }}>
          <Warning />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong>Gotcha:</strong> {receipt.gotcha}
          </div>
        </div>
      )}

      {receipt.status === 'returned' ? (
        <>
          {/* The date, which the receipt has been storing since the day this
              screen was written and never showing. "£89.00 recovered ✓" is
              the same sentence whether the refund landed last week or last
              year, and it is the only fact a returned receipt carries that is
              not already on the row. */}
          <div style={{ marginTop: 16, padding: 15, textAlign: 'center', background: color.yellowLight, border: `1.5px solid ${color.ink}`, borderRadius: 16, fontWeight: 700 }}>
            Money back · {money(receipt.amount)} recovered{returnedText ? ` on ${returnedText}` : ''} ✓
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <Pressable
              className="k-row-white"
              onClick={onUnreturn}
              style={{ flex: 1, padding: 15, textAlign: 'center', background: color.white, border: `1.5px solid ${color.borderSoft}`, borderRadius: 999, fontWeight: 700, fontSize: 14 }}
            >
              Not actually returned
            </Pressable>
            <Pressable
              onClick={onDelete}
              style={{ width: 'auto', padding: '15px 18px', textAlign: 'center', background: color.white, border: `1.5px solid ${color.borderSoft}`, color: color.danger, borderRadius: 999, fontWeight: 700, fontSize: 14 }}
            >
              Delete
            </Pressable>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Pressable
            className="k-cta-yellow"
            onClick={onReturn}
            style={{ flex: 1, padding: 16, textAlign: 'center', background: color.yellow, border: `1.5px solid ${color.ink}`, borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: shadow.hard }}
          >
            Got my money back
          </Pressable>
          <Pressable
            onClick={onDelete}
            style={{ width: 'auto', padding: '16px 18px', textAlign: 'center', background: color.white, border: `1.5px solid ${color.borderSoft}`, color: color.danger, borderRadius: 999, fontWeight: 700, fontSize: 15 }}
          >
            Delete
          </Pressable>
        </div>
      )}
    </div>
  );
}
