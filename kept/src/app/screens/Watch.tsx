import { color, radius } from '../../tokens';
import { fromISODate, relativeAgo } from '../../lib/dates';
import { assess } from '../../lib/policy-feed';
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
  const assessed = assess(updates, receipts, today);

  return (
    // tabIndex on a scroll container looks odd until you notice this screen
    // has nothing focusable in it: every other screen holds buttons or inputs,
    // so tabbing through them scrolls the region as a side effect. Here there
    // is nothing to tab to, and a keyboard user could not scroll the feed at
    // all. The role and label keep it announced as a place rather than an
    // unexplained stop on the tab order.
    <div
      className="k-fade"
      tabIndex={0}
      role="region"
      aria-label="Policy updates"
      style={{ flex: 1, overflow: 'auto', padding: '6px 16px 120px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px 4px' }}>
        <span className="k-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: color.yellow }} />
        <h1 tabIndex={-1} style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Policy watch</h1>
      </div>
      <p style={{ fontSize: 13, color: color.muted, padding: '0 2px 14px', margin: 0 }}>
        Shops rewrite the rules quietly. You hear about it first — and every receipt you hold is checked against
        the change.
      </p>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
        {assessed.map(({ update: u, impacts, affectsYou }) => {
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
                  {/* Per receipt, not one line for the shop: what a change means
                      depends on the terms each purchase was made under. */}
                  {impacts.map((i) => (
                    <div key={i.receipt.id} style={{ fontSize: 12.5, color: color.muted, marginTop: 4 }}>
                      <span style={{ fontWeight: 700, color: color.bodyStrong }}>{i.receipt.item}</span> — {i.note}
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p style={{ fontSize: 11, color: color.muted, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
        {/* It said "Policies verified daily by kept · last check today 06:00".
            Nothing verifies daily and nothing recorded a check time — the hour
            was invented. What is true is where the list comes from and when it
            is fetched, which is worth saying and is checkable. */}
        Kept’s own list of changes, fetched each time you open the app
        <br />
        The whole list downloads, never a query naming your shops — receipts never leave your phone.
      </p>
    </div>
  );
}
