import { useRef, useState } from 'react';
import { color, radius } from '../../tokens';
import { mergeBackup, parseBackup } from '../../lib/backup';
import type { Receipt } from '../../lib/types';
import { LEGAL_DISCLAIMER } from '../../lib/legal';
import { VERIFIED_STORE_COUNT } from '../../lib/stores';
import { FREE_TIER_LIMIT, type Settings as SettingsShape } from '../../lib/storage';
import { Pressable } from '../components/Pressable';

interface Props {
  settings: SettingsShape;
  receiptCount: number;
  receipts: Receipt[];
  onExport: () => void;
  onRestore: (receipts: Receipt[]) => void;
  onUpgrade: (plan: 'monthly' | 'yearly' | 'lifetime') => void;
  onChange: (patch: Partial<SettingsShape>) => void;
}

const RESTORE_FAILURES = {
  'not-json': 'That file isn’t readable — pick the .json file kept exported.',
  'not-a-kept-backup': 'That’s a JSON file, but not a kept backup.',
  'nothing-usable': 'That backup’s receipts couldn’t be read — nothing was changed.',
} as const;

export function Settings({ settings, receiptCount, receipts, onExport, onRestore, onUpgrade, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoreNote, setRestoreNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const restore = async (file: File) => {
    const outcome = parseBackup(await file.text());
    if (!outcome.ok) {
      setRestoreNote({ tone: 'bad', text: RESTORE_FAILURES[outcome.reason] });
      return;
    }
    const { receipts: merged, added, replaced } = mergeBackup(receipts, outcome.summary.receipts);
    onRestore(merged);
    const parts = [
      `${added} restored`,
      ...(replaced ? [`${replaced} updated`] : []),
      ...(outcome.summary.skipped ? [`${outcome.summary.skipped} unreadable and skipped`] : []),
    ];
    setRestoreNote({ tone: 'ok', text: `${parts.join(' · ')}. Nothing already here was lost.` });
  };

  const free = settings.plan === 'free';
  const usagePct = Math.min(100, (receiptCount / FREE_TIER_LIMIT) * 100);

  return (
    <div className="k-fade" style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, padding: '10px 2px 14px', margin: 0 }}>Settings</h1>

      <section style={{ background: color.white, border: `1.5px solid ${color.border}`, borderRadius: radius.cardLg, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: color.yellow }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Private by design</span>
        </div>
        <p style={{ fontSize: 13, color: color.muted, lineHeight: 1.55, marginTop: 6, marginBottom: 0 }}>
          Everything lives on this device. No account, no server, no one reading your purchases.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Pressable
            className="k-soft"
            onClick={onExport}
            style={{ flex: 1, padding: 12, textAlign: 'center', background: color.creamAlt, borderRadius: 999, fontWeight: 700, fontSize: 13 }}
          >
            Export a backup
          </Pressable>
          {/* Export without restore is a dead end. With no account, this file is
              the only way anything moves to a new phone. */}
          <Pressable
            className="k-soft"
            onClick={() => fileInput.current?.click()}
            style={{ flex: 1, padding: 12, textAlign: 'center', background: color.creamAlt, borderRadius: 999, fontWeight: 700, fontSize: 13 }}
          >
            Restore
          </Pressable>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
            // Cleared so picking the same file twice fires change again.
            e.target.value = '';
          }}
        />
        {restoreNote && (
          <div
            role="status"
            style={{
              marginTop: 10, padding: '10px 13px', borderRadius: 14, fontSize: 12.5, fontWeight: 600, lineHeight: 1.5,
              background: restoreNote.tone === 'ok' ? color.yellowLight : 'rgba(216,66,46,0.10)',
              color: restoreNote.tone === 'ok' ? color.ink : color.danger,
            }}
          >
            {restoreNote.text}
          </div>
        )}
      </section>

      {free && (
        <section style={{ background: color.ink, color: color.cream, borderRadius: radius.cardLg, padding: 18, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Free plan</span>
            <span style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 12, color: color.faint }}>
              {receiptCount} of {FREE_TIER_LIMIT} free receipts
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={receiptCount}
            aria-valuemin={0}
            aria-valuemax={FREE_TIER_LIMIT}
            aria-label="Free receipts used"
            style={{ height: 6, borderRadius: 999, background: color.onInkBorder, marginTop: 10, overflow: 'hidden' }}
          >
            <div style={{ height: '100%', background: color.yellow, borderRadius: 999, width: `${usagePct}%` }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
            <Tier price="£2.99" period="monthly" onClick={() => onUpgrade('monthly')} />
            <Tier price="£16.99" period="yearly" featured onClick={() => onUpgrade('yearly')} />
            <Tier price="£39.99" period="lifetime" onClick={() => onUpgrade('lifetime')} />
          </div>
          <div style={{ fontSize: 11, color: color.faint, textAlign: 'center', marginTop: 10 }}>One missed return pays for it.</div>
        </section>
      )}

      <section style={{ background: color.white, border: `1.5px solid ${color.border}`, borderRadius: radius.cardLg, marginTop: 12, overflow: 'hidden' }}>
        <Toggle
          label="Deadline alerts"
          value={settings.deadlineAlerts}
          detail={settings.deadlineAlerts ? 'This week' : 'Off'}
          onChange={(v) => onChange({ deadlineAlerts: v })}
        />
        <Toggle
          label="Policy watch"
          value={settings.policyWatch}
          detail={settings.policyWatch ? 'Daily · on' : 'Off'}
          onChange={(v) => onChange({ policyWatch: v })}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '15px 18px' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Retailer policies</span>
          <span style={{ fontSize: 14, color: color.muted }}>{VERIFIED_STORE_COUNT} verified today</span>
        </div>
      </section>

      <section style={{ background: color.white, border: `1.5px solid ${color.border}`, borderRadius: radius.cardLg, marginTop: 12, padding: '15px 18px' }}>
        <label htmlFor="urgent" style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>
          Call it urgent under
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <input
            id="urgent"
            type="range"
            min={2}
            max={21}
            step={1}
            value={settings.urgentDays}
            onChange={(e) => onChange({ urgentDays: Number(e.target.value) })}
            style={{ flex: 1, accentColor: color.yellow }}
          />
          <span style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 700, fontSize: 14, minWidth: 56, textAlign: 'right' }}>
            {settings.urgentDays} days
          </span>
        </div>
      </section>

      <p style={{ fontSize: 11, color: color.faint, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
        kept · work hard, play hard — get your money back
        <br />
        {LEGAL_DISCLAIMER}
      </p>
    </div>
  );
}

function Tier({ price, period, featured, onClick }: { price: string; period: string; featured?: boolean; onClick: () => void }) {
  return (
    <Pressable
      onClick={onClick}
      style={{
        border: `1.5px solid ${featured ? color.yellow : color.onInkBorderStrong}`,
        borderRadius: 14, padding: '13px 8px', textAlign: 'center', position: 'relative',
        background: featured ? 'rgba(242,185,13,0.1)' : 'transparent',
      }}
    >
      {featured && (
        <span style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', background: color.yellow, color: color.ink, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
          BEST VALUE
        </span>
      )}
      <div style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 700, fontSize: 14, color: featured ? color.yellow : color.cream }}>{price}</div>
      <div style={{ fontSize: 11, color: color.faint, marginTop: 2 }}>{period}</div>
    </Pressable>
  );
}

/**
 * The design drew these as static rows ending in a chevron. They are the two
 * things the app actually does to you unprompted, so they are switches: a
 * notification setting you can read but not change is a setting in name only.
 */
function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: `1.5px solid ${color.borderHair}` }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, color: color.muted }}>{detail}</span>
        <span
          aria-hidden="true"
          style={{
            width: 40, height: 24, borderRadius: 999, flexShrink: 0,
            background: value ? color.yellow : color.creamAlt,
            border: `1.5px solid ${value ? color.ink : color.border}`,
            display: 'flex', alignItems: 'center', padding: 2, transition: 'background .2s',
          }}
        >
          <span
            style={{
              width: 16, height: 16, borderRadius: 999, background: value ? color.ink : color.white,
              border: value ? undefined : `1px solid ${color.border}`,
              transform: `translateX(${value ? 16 : 0}px)`, transition: 'transform .2s',
            }}
          />
        </span>
      </span>
    </Pressable>
  );
}
