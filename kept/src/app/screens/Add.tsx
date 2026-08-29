import { useEffect, useState } from 'react';
import { color, radius, shadow } from '../../tokens';
import { addDays, fmtDate, fmtDateNear, fromISODate } from '../../lib/dates';
import { money } from '../../lib/money';
import { parseReceiptText, type ParsedReceipt } from '../../lib/parse';
import { makeReceiptId } from '../../lib/receipts';
import { findStore, policyFor } from '../../lib/stores';
import { FEATURED_TIER } from '../../lib/pricing';
import { FREE_TIER_LIMIT } from '../../lib/quota';
import type { Receipt } from '../../lib/types';
import { ArrowRight, CameraGlyph, LogoMark, MailGlyph, ShareGlyph, Warning } from '../components/Icons';
import { HowBought } from '../components/HowBought';
import { Pressable } from '../components/Pressable';

interface Props {
  today: Date;
  /**
   * An order email shared in from another app. Arriving with text already in
   * hand, the screen reads it immediately — a share that lands on an empty box
   * and waits to be told to try is not the flow the three-step strip promises.
   */
  sharedText?: string;
  quotaFull: boolean;
  trackedTotal: string;
  onSave: (r: Receipt) => void;
  onUpgrade: () => void;
}

export function Add({ today, sharedText, quotaFull, trackedTotal, onSave, onUpgrade }: Props) {
  const [text, setText] = useState(sharedText ?? '');
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [error, setError] = useState(false);
  // The parser can read a shop and a total, but nothing in an order email
  // reliably says what the thing WAS. Asking here is why the list stops
  // filling up with rows called "From pasted email".
  const [item, setItem] = useState('');
  /**
   * This screen's input is a pasted order email, so a distance purchase is the
   * likelier answer and is offered first — but it is ASKED rather than assumed.
   * It used to be hardcoded true, which told every receipt anyone added by hand
   * that they had a 14-day right to cancel for any reason. Someone who bought
   * it over a counter has no such right, and finds that out at the counter.
   */
  const [distance, setDistance] = useState(true);
  /**
   * The shop, when the paste did not name one Kept knows.
   *
   * The parser deliberately says nothing rather than guessing — "walking
   * boots" is not a Boots order — so this is where the person supplies what it
   * would have been guessing at. Typing a shop Kept does know adopts its real
   * window and wording, which is the whole product; typing anything else
   * leaves the assumed window it already shows.
   */
  const [storeName, setStoreName] = useState('');
  // Read once, on arrival. A later keystroke must not re-trigger it.
  const [readShare, setReadShare] = useState(false);

  const readText = (source: string) => {
    const outcome = parseReceiptText(source, today);
    if (!outcome.ok) {
      setParsed(null);
      setError(true);
      return;
    }
    setParsed(outcome.value);
    setError(false);
    setItem('');
    setDistance(true);
    setStoreName('');
  };

  const read = () => readText(text);

  useEffect(() => {
    if (!sharedText || readShare) return;
    setReadShare(true);
    readText(sharedText);
    // readText is stable enough for this one-shot: the effect is gated on a
    // flag, so a changing identity cannot make it fire twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedText, readShare]);

  /**
   * What the receipt will actually be saved with — the paste's shop, or the
   * one typed in when it found none. Computed once and read by both the save
   * and the deadline preview below, because a preview that disagreed with what
   * lands is a bug this codebase has already had once.
   */
  const typed = storeName.trim();
  const knownFromTyped = parsed?.store ? undefined : typed ? findStore(typed) : undefined;
  const policy = parsed?.policy ?? knownFromTyped ?? null;
  const effectiveStore = parsed?.store ?? policy?.name ?? typed;
  const effectiveWindow = policy?.windowDays ?? parsed?.windowDays ?? 0;

  const save = () => {
    if (!parsed || quotaFull) return;
    const store = effectiveStore || 'Unknown store';
    onSave({
      id: makeReceiptId(today),
      store,
      // A generic fallback, not a dead end: it is editable from the receipt
      // itself the moment this saves.
      item: item.trim() || `${store} purchase`,
      cat: policy?.cat ?? 'other',
      amount: parsed.amount ?? 0,
      purchasedOn: parsed.purchasedOn,
      // A dispatch-clocked retailer starts counting when the parcel leaves,
      // and a pasted order confirmation cannot know that date. Leaving it
      // unset counts from the order — the conservative reading is the one
      // that does not promise days the shop will not honour.
      windowDays: effectiveWindow,
      policy: policyFor(store, effectiveWindow),
      distance,
      gotcha: policy?.gotcha,
      status: 'active',
    });
  };

  const deadline = parsed ? fmtDateNear(addDays(fromISODate(parsed.purchasedOn), effectiveWindow), today) : '';

  return (
    <div className="k-fade" style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <h1 tabIndex={-1} style={{ fontSize: 24, fontWeight: 700, padding: '10px 2px 4px', margin: 0 }}>Add a receipt</h1>
      <p style={{ fontSize: 13, color: color.muted, padding: '0 2px 14px', margin: 0 }}>
        Paste an order email — kept reads the store, total and date.
      </p>

      <label htmlFor="paste" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Paste your order email
      </label>
      <textarea
        id="paste"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParsed(null);
          setError(false);
        }}
        placeholder="Paste your order email here… e.g. 'Your Apple order · Total £129.00 · 25 Aug'"
        style={{
          width: '100%', boxSizing: 'border-box', height: 120, border: '1.5px dashed rgba(23,20,16,0.3)',
          borderRadius: radius.card, background: color.white, padding: 14,
          fontFamily: "'Space Grotesk', monospace", fontSize: 13, color: color.ink, resize: 'none',
        }}
      />

      <Pressable
        className="k-cta-yellow"
        onClick={read}
        style={{ marginTop: 12, padding: 16, textAlign: 'center', background: color.yellow, border: `1.5px solid ${color.ink}`, borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: shadow.hard }}
      >
        Read it
      </Pressable>

      {error && (
        <div className="k-fade" role="alert" style={{ display: 'flex', gap: 10, background: color.white, border: '1.5px solid rgba(216,66,46,0.4)', borderRadius: 16, padding: '14px 16px', marginTop: 14 }}>
          <Warning stroke={color.danger} />
          <div style={{ fontSize: 13, color: color.danger, lineHeight: 1.5, fontWeight: 600 }}>
            Couldn’t find a store or amount in that. Make sure the paste includes the shop’s name and a £ total — or add it by scanning the paper receipt.
          </div>
        </div>
      )}

      {quotaFull && (
        <div style={{ background: color.ink, color: color.cream, borderRadius: radius.cardLg, padding: 18, marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>That’s your {FREE_TIER_LIMIT} free receipts</div>
          <div style={{ fontSize: 13, color: color.fainter, lineHeight: 1.55, marginTop: 6 }}>
            Kept has tracked {trackedTotal} for free. Return something you are already tracking and a slot frees up —
            or go unlimited, and one missed return pays for the year.
          </div>
          <Pressable
            className="k-cta-yellow"
            onClick={onUpgrade}
            style={{ marginTop: 12, padding: 13, textAlign: 'center', background: color.yellow, color: color.ink, borderRadius: 999, fontWeight: 700, fontSize: 14 }}
          >
            {`Go unlimited · ${FEATURED_TIER.price}${FEATURED_TIER.suffix}`}
          </Pressable>
        </div>
      )}

      {parsed && (
        <div className="k-fade" style={{ background: color.white, border: `1.5px solid ${color.ink}`, borderRadius: radius.cardLg, padding: 18, marginTop: 16, boxShadow: shadow.hard }}>
          <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 11, letterSpacing: '1.6px', color: color.amber, fontWeight: 700 }}>
            FOUND IN YOUR PASTE
          </div>
          <div style={{ marginTop: 12 }}>
            <label htmlFor="add-item" style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.6px', color: color.muted, marginBottom: 6 }}>
              WHAT IS IT?
            </label>
            <input
              id="add-item"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Wool-blend overcoat"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 14,
                border: `1.5px solid ${color.border}`, background: color.white,
                fontFamily: "'Instrument Sans', system-ui, sans-serif", fontSize: 14.5, color: color.ink,
              }}
            />
          </div>
          {parsed.store === null && (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="add-store" style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: '0.6px', color: color.muted, marginBottom: 6 }}>
                WHICH SHOP?
              </label>
              <input
                id="add-store"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Vinted"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 14,
                  border: `1.5px solid ${color.border}`, background: color.white,
                  fontFamily: "'Instrument Sans', system-ui, sans-serif", fontSize: 14.5, color: color.ink,
                }}
              />
              <div style={{ fontSize: 12.5, color: color.muted, marginTop: 5 }}>
                {knownFromTyped
                  ? `${knownFromTyped.name} — ${knownFromTyped.windowDays} days, verified.`
                  : 'We could not find a shop we know in that paste. Name it and we will use its real window if we have it.'}
              </div>
            </div>
          )}
          <HowBought id="add-how" value={distance} onChange={setDistance} />
          <Row label="Store" value={effectiveStore || 'Not recognised'} mono={false} />
          <Row label="Total" value={parsed.amount === null ? 'Not found' : money(parsed.amount)} mono />
          <Row label="Bought" value={`${fmtDate(fromISODate(parsed.purchasedOn))}${parsed.dateFound ? '' : ' (assumed today)'}`} mono />
          <Row label="Return window" value={`${effectiveWindow} days`} mono={false} />
          <Row label="Deadline" value={deadline} mono accent />
          {/* The cap is claimed on the pricing page, in Settings and on the
              card above; a Save that quietly ignored it would make all three
              of those decorative. */}
          <Pressable
            className={quotaFull ? undefined : 'k-ink'}
            onClick={save}
            disabled={quotaFull}
            style={{
              marginTop: 14, padding: 14, textAlign: 'center',
              background: quotaFull ? color.creamAlt : color.ink,
              color: quotaFull ? color.muted : color.cream,
              borderRadius: 999, fontWeight: 700, fontSize: 14,
              cursor: quotaFull ? 'not-allowed' : 'pointer',
            }}
          >
            {quotaFull ? 'Go unlimited to save this' : 'Save receipt'}
          </Pressable>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1.5, background: color.border }} />
        <span style={{ fontSize: 12, color: color.muted }}>or</span>
        <div style={{ flex: 1, height: 1.5, background: color.border }} />
      </div>

      <Pressable
        className="k-row-white"
        // Camera capture is the next build; saying so beats a control that
        // silently does nothing when tapped.
        disabled
        title="Receipt scanning is coming in a later release"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16,
          background: color.white, border: `1.5px solid ${color.ink}`, borderRadius: 999,
          fontWeight: 700, fontSize: 15, opacity: 0.5, cursor: 'not-allowed',
        }}
      >
        <CameraGlyph />
        Scan a paper receipt
        <span style={{ fontSize: 10, fontWeight: 700, background: color.creamAlt, padding: '2px 8px', borderRadius: 999 }}>SOON</span>
      </Pressable>

      <div style={{ background: color.creamAlt, border: '1.5px dashed rgba(23,20,16,0.2)', borderRadius: radius.card, padding: '16px 18px', marginTop: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: color.muted }}>COMING FROM YOUR EMAIL APP?</div>
        <div style={{ fontSize: 12, color: color.muted, lineHeight: 1.5, marginTop: 6 }}>
          Add kept to your home screen and it appears in the share sheet — the order lands here already read.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <Step icon={<MailGlyph />} label="Open the order" />
          <ArrowRight stroke={color.fainter} />
          <Step icon={<ShareGlyph />} label="Tap share" />
          <ArrowRight stroke={color.fainter} />
          <Step icon={<LogoMark size={18} />} label="Pick kept — done" dark />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, accent }: { label: string; value: string; mono: boolean; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
      <span style={{ color: color.muted, fontSize: 13 }}>{label}</span>
      <span
        style={{
          fontWeight: 700, fontSize: 14, textAlign: 'right',
          fontFamily: mono ? "'Space Grotesk', monospace" : undefined,
          color: accent ? color.amber : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Step({ icon, label, dark }: { icon: React.ReactNode; label: string; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
      <div
        style={{
          width: 40, height: 40, borderRadius: 12,
          background: dark ? color.ink : color.white,
          border: dark ? undefined : `1.5px solid ${color.borderSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: color.muted, textAlign: 'center' }}>{label}</span>
    </div>
  );
}
