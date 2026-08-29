import { useState } from 'react';
import { color, radius, shadow } from '../../tokens';
import { applyDraft, countsFromDispatch, draftFrom, effectiveWindowStart, validateDraft, type DraftErrors, type ReceiptDraft } from '../../lib/draft';
import { addDays, addMonths, fmtDateLong, fmtDateNear, fromISODate, toISODate } from '../../lib/dates';
import { STORE_POLICIES } from '../../lib/stores';
import type { Category, Receipt } from '../../lib/types';
import { CatIcon, ChevronLeft } from '../components/Icons';
import { Field, inputStyle } from '../components/Field';
import { HowBought } from '../components/HowBought';
import { Pressable } from '../components/Pressable';

const CATEGORIES: { cat: Category; label: string }[] = [
  { cat: 'audio', label: 'Tech' },
  { cat: 'kitchen', label: 'Kitchen' },
  { cat: 'clothing', label: 'Clothing' },
  { cat: 'beauty', label: 'Beauty' },
  { cat: 'furniture', label: 'Home' },
  { cat: 'other', label: 'Other' },
];

interface Props {
  receipt: Receipt;
  today: Date;
  onSave: (r: Receipt) => void;
  onCancel: () => void;
}

export function Edit({ receipt, today, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ReceiptDraft>(() => draftFrom(receipt));
  const [errors, setErrors] = useState<DraftErrors>({});

  const set = <K extends keyof ReceiptDraft>(key: K, value: ReceiptDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    // Clear this field's complaint as soon as it is being addressed; leaving it
    // shouting while someone fixes it is just noise.
    setErrors((e) => (key in e ? { ...e, [key]: undefined } : e));
  };

  const save = () => {
    const out = validateDraft(draft, today);
    if (!out.ok) {
      setErrors(out.errors);
      return;
    }
    onSave(applyDraft(receipt, out.value));
  };

  // Live preview of the consequence, because the window and the purchase date
  // are abstractions and the deadline is the thing the person actually cares
  // about.
  const windowDays = Number(draft.windowDaysText);
  const previewable = /^\d{4}-\d{2}-\d{2}$/.test(draft.purchasedOn) && Number.isInteger(windowDays) && windowDays > 0;
  // Counted from where the window will actually start once saved — which is
  // the dispatch date, on a shop that uses one. Previewing from the purchase
  // date showed a deadline two days adrift from the receipt's own.
  const windowStart = effectiveWindowStart(receipt, draft);
  const deadline = previewable ? fmtDateNear(addDays(fromISODate(windowStart), windowDays), today) : null;

  const warrantyMonths = Number(draft.warrantyMonthsText.trim());
  const warrantyEnds =
    /^\d{4}-\d{2}-\d{2}$/.test(draft.purchasedOn) && Number.isInteger(warrantyMonths) && warrantyMonths > 0
      ? fmtDateLong(addMonths(fromISODate(draft.purchasedOn), warrantyMonths))
      : null;

  return (
    <div className="k-fade" style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <Pressable
        className="k-row-white"
        onClick={onCancel}
        style={{
          display: 'inline-flex', width: 'auto', alignItems: 'center', gap: 6, padding: '9px 15px 9px 11px',
          background: color.white, border: `1.5px solid ${color.ink}`, borderRadius: 999,
          fontSize: 13, fontWeight: 700, margin: '8px 0 16px',
        }}
      >
        <ChevronLeft />
        Cancel
      </Pressable>

      <h1 tabIndex={-1} style={{ fontSize: 24, fontWeight: 700, padding: '0 2px 4px', margin: 0 }}>Edit receipt</h1>
      <p style={{ fontSize: 13, color: color.muted, padding: '0 2px 6px', margin: 0 }}>
        Fix anything the paste got wrong — or give it a name you will recognise later.
      </p>

      <div style={{ background: color.white, border: `1.5px solid ${color.border}`, borderRadius: radius.cardLg, padding: '4px 18px 20px', marginTop: 12 }}>
        <Field id="e-store" label="Shop" error={errors.store} hint="A shop we know brings its policy and window with it.">
          {(p) => (
            <>
              <input
                {...p}
                list="known-stores"
                value={draft.store}
                onChange={(e) => set('store', e.target.value)}
                style={inputStyle(p['aria-invalid'])}
              />
              <datalist id="known-stores">
                {STORE_POLICIES.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field id="e-item" label="What is it?" error={errors.item}>
          {(p) => (
            <input
              {...p}
              value={draft.item}
              placeholder="Running shoes"
              onChange={(e) => set('item', e.target.value)}
              style={inputStyle(p['aria-invalid'])}
            />
          )}
        </Field>

        <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
          <legend style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.6px', color: color.muted, padding: 0, marginBottom: 6 }}>
            CATEGORY
          </legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(({ cat, label }) => {
              const on = draft.cat === cat;
              return (
                <Pressable
                  key={cat}
                  onClick={() => set('cat', cat)}
                  aria-pressed={on}
                  style={{
                    width: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                    borderRadius: 999, border: `1.5px solid ${on ? color.ink : color.border}`,
                    background: on ? color.yellowLight : color.white, fontSize: 12.5, fontWeight: 700,
                  }}
                >
                  <CatIcon cat={cat} />
                  {label}
                </Pressable>
              );
            })}
          </div>
        </fieldset>

        <Field id="e-amount" label="Amount" error={errors.amountText}>
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={draft.amountText}
              placeholder="24.99"
              onChange={(e) => set('amountText', e.target.value)}
              style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
            />
          )}
        </Field>

        <Field id="e-bought" label="Bought on" error={errors.purchasedOn}>
          {(p) => (
            <input
              {...p}
              type="date"
              value={draft.purchasedOn}
              max={toISODate(today)}
              onChange={(e) => set('purchasedOn', e.target.value)}
              style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
            />
          )}
        </Field>

        {/* Correctable here as well as at the point of adding, because a
            receipt saved from a pasted email defaults to a distance purchase
            and someone who pasted a shop receipt has to be able to say so. */}
        <HowBought id="e-how" value={draft.distance} onChange={(v) => set('distance', v)} />

        {/* Only for a delivered order. A counter purchase arrives when it is
            bought, and both statutory clocks start when the goods reach you —
            so without this the app can only say "at least until". */}
        {draft.distance && (
          <Field
            id="e-arrived"
            label="Arrived on"
            error={errors.arrivedOnText}
            hint={draft.arrivedOnText ? undefined : 'Optional. Leave blank if it has not arrived, or you cannot remember.'}
          >
            {(p) => (
              <input
                {...p}
                type="date"
                value={draft.arrivedOnText}
                max={toISODate(today)}
                onChange={(e) => set('arrivedOnText', e.target.value)}
                style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
              />
            )}
          </Field>
        )}

        {/* Only for a shop that starts its own window at the warehouse — one
            of the twenty does. The detail screen otherwise tells the person
            that "this receipt does not say when that was" and offers no way
            to say it, which is an instruction to do something impossible. */}
        {countsFromDispatch(draft.store) && (
          <Field
            id="e-dispatched"
            label="Dispatched on"
            error={errors.dispatchedOnText}
            hint={
              draft.dispatchedOnText
                ? undefined
                : `${draft.store.trim() || 'This shop'} counts its window from dispatch. Without this the deadline is the earliest it can be.`
            }
          >
            {(p) => (
              <input
                {...p}
                type="date"
                value={draft.dispatchedOnText}
                max={toISODate(today)}
                onChange={(e) => set('dispatchedOnText', e.target.value)}
                style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
              />
            )}
          </Field>
        )}

        <Field
          id="e-window"
          label="Return window (days)"
          error={errors.windowDaysText}
          hint={deadline ? `Deadline: ${deadline}` : undefined}
        >
          {(p) => (
            <input
              {...p}
              inputMode="numeric"
              value={draft.windowDaysText}
              onChange={(e) => set('windowDaysText', e.target.value)}
              style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
            />
          )}
        </Field>

        <Field
          id="e-warranty"
          label="Warranty (months)"
          error={errors.warrantyMonthsText}
          hint={warrantyEnds ? `Cover until ${warrantyEnds}` : 'Leave blank if there is none.'}
        >
          {(p) => (
            <input
              {...p}
              inputMode="numeric"
              value={draft.warrantyMonthsText}
              placeholder="24"
              onChange={(e) => set('warrantyMonthsText', e.target.value)}
              style={{ ...inputStyle(p['aria-invalid']), fontFamily: "'Space Grotesk', monospace" }}
            />
          )}
        </Field>
      </div>

      {windowStart !== draft.purchasedOn && (
        <p style={{ fontSize: 12.5, color: color.muted, lineHeight: 1.55, margin: '12px 4px 0' }}>
          This shop counts from dispatch ({fmtDateNear(fromISODate(windowStart), today)}), so the deadline above is measured
          from that date rather than the day you ordered. Changing the shop drops it.
        </p>
      )}

      <Pressable
        className="k-cta-yellow"
        onClick={save}
        style={{ marginTop: 16, padding: 16, textAlign: 'center', background: color.yellow, border: `1.5px solid ${color.ink}`, borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: shadow.hard }}
      >
        Save changes
      </Pressable>
    </div>
  );
}
