import { color, radius } from '../../tokens';
import { Pressable } from './Pressable';

/**
 * Where the purchase was made — the one question that decides whether the app
 * states a 14-day right to cancel for any reason.
 *
 * It lives in a component of its own, used by both the add and the edit
 * screens, because the wording is a legal claim and two screens phrasing it
 * differently is how this product has drifted before. The answer feeds
 * `Receipt.distance`; legal.ts explains what it decides.
 *
 * A radiogroup rather than a switch: "in a shop" is not the off state of
 * "online", and a switch would leave a screen reader announcing one of the two
 * real answers as "not the other one".
 */
export function HowBought({ id, value, onChange }: { id: string; value: boolean; onChange: (distance: boolean) => void }) {
  const options: { distance: boolean; label: string }[] = [
    { distance: false, label: 'In a shop' },
    { distance: true, label: 'Online or phone' },
  ];

  return (
    <div style={{ marginTop: 14 }}>
      <div id={`${id}-label`} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.6px', color: color.muted, marginBottom: 6 }}>
        WHERE DID YOU BUY IT?
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-label`} style={{ display: 'flex', gap: 8, minWidth: 0 }}>
        {options.map((option) => {
          const selected = option.distance === value;
          return (
            <Pressable
              key={option.label}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.distance)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '11px 10px',
                borderRadius: radius.card,
                border: `1.5px solid ${selected ? color.ink : color.border}`,
                background: selected ? color.yellowLight : color.white,
                fontSize: 14,
                fontWeight: 700,
                color: color.ink,
              }}
            >
              {option.label}
            </Pressable>
          );
        })}
      </div>
      <div style={{ fontSize: 12.5, color: color.muted, marginTop: 5 }}>
        Buying online adds a 14-day right to cancel for any reason. Buying in a shop does not.
      </div>
    </div>
  );
}
