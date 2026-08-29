import { fromISODate, relativeAgo } from '../lib/dates';
import { seedUpdates } from '../lib/seed';
import { STORE_POLICIES, findStore } from '../lib/stores';

/**
 * The scrolling headline bar, derived from the table and the feed it claims
 * to be reporting.
 *
 * These were five hand-typed strings, and they lived in
 * `placeholder-content.ts` — a module whose own header says "nothing here is
 * measured" — under a note exempting them from it because they "restate
 * published retailer policies". That is exactly the reason they do not belong
 * there: a restatement is only true while it matches what it restates, and
 * nothing was holding it. The README's own pre-ship task is to check all
 * twenty windows against each retailer's terms; whoever does that changes
 * `stores.ts` and would have left this bar announcing the old numbers, on the
 * page whose entire claim is that kept knows the real ones.
 *
 * One of them was already wrong in a small way. "IKEA: 365 days, still
 * unbeaten" singles out IKEA, and Decathlon matches it at 365 in kept's own
 * list — literally unbeaten, and reading as a claim the table does not make.
 * The line is computed from the longest window now, and worded so a tie is
 * still true.
 */
const longest = [...STORE_POLICIES].sort((a, b) => b.windowDays - a.windowDays)[0];
const days = (name: string) => findStore(name)?.windowDays ?? 0;

/**
 * A gotcha, ready to follow "UNIQLO:" without saying Uniqlo twice.
 *
 * Every gotcha in the table opens with the shop's own name, because on the
 * detail screen it is read on its own; here the bar has already said it.
 */
function gotchaOf(name: string): string {
  const g = findStore(name)?.gotcha ?? '';
  return g.replace(new RegExp(`^${name}\\s+`, 'i'), '');
}

export function tickerLines(today: Date): string[] {
  const newest = seedUpdates(today)[0];
  return [
    `${newest.store.toUpperCase()} changed its returns policy ${relativeAgo(fromISODate(newest.changedOn), today)} — kept already updated`,
    `ASOS: ${days('ASOS')}-day window for frequent returners`,
    `${longest.name.toUpperCase()}: ${longest.windowDays} days, and nothing in kept’s list beats it`,
    `APPLE: ${days('Apple')}-day window confirmed for iPhone 18`,
    `UNIQLO: ${gotchaOf('Uniqlo')}`,
  ];
}
