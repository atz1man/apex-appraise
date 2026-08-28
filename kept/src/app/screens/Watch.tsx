import { color, radius } from '../../tokens';
import { fromISODate, relativeAgo } from '../../lib/dates';
import type { PolicyUpdate, Receipt } from '../../lib/types';

interface Props {
  updates: PolicyUpdate[];
  receipts: Receipt[];
  today: Date;
}

/**
 * The policy feed. Whether an update "affects you" is decided here against
 * the receipts actually held, not baked into the update: the same downloaded
 * item is a headline for one person and an alarm for another, and only the
 * device knows which.
 */
export function Watch({ updates, receipts, today }: Props) {
  const heldStores = new Set(receipts.filter((r) => r.status === 'active').map((r) => r.store));

  return (
    <div className="k-fade" style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px 4px' }}>
        <span className="k-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: color.yellow }} />
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Policy watch</h1>
      </div>
      <p style={{ fontSize: 13, color: color.muted, padding: '0 2px 14px', margin: 0 }}>
        Shops rewrite the rules quietly. You hear about it first — deadlines re-calculate themselves.
      </p>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
        {updates.map((u) => {
          const affected = u.affectsStores.filter((s) => heldStores.has(s));
          const affectsYou = affected.length > 0;
          return (
            <li
              key={u.id}
              style={{
                listStyle: 'none', background: color.white,
                border: `1.5px solid ${affectsYou ? color.ink : color.border}`,
                borderRadius: radius.card, padding: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15.5 }}>{u.store}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, background: color.yellowLight, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                  {relativeAgo(fromISODate(u.changedOn), today)}
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: color.body, lineHeight: 1.55, marginTop: 8 }}>{u.text}</div>
              {affectsYou && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1.5px dashed ${color.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: color.amber }}>AFFECTS YOUR RECEIPTS</div>
                  <div style={{ fontSize: 12.5, color: color.muted, marginTop: 3 }}>{u.affectNote}</div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p style={{ fontSize: 11, color: color.muted, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
        Policies verified daily by kept · last check today 06:00
        <br />
        Updates download in the background — receipts never leave your phone.
      </p>
    </div>
  );
}
