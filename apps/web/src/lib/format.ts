export {
  formatDelta,
  formatMoney,
  formatMoneyFull,
  formatPct,
  formatPp,
  formatRent,
  formatSigned,
} from '@apex/appraisal-engine';

/** £7.24m for ≥£10m one dp, else two dp; £625k under £1m (board cards). */
export function fM(pounds: number): string {
  const a = Math.abs(pounds);
  const s = pounds < 0 ? '−' : '';
  if (a >= 1e6) return `${s}£${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
  if (a >= 1e3) return `${s}£${Math.round(a / 1e3)}k`;
  return `${s}£${Math.round(a)}`;
}

export const n0 = (n: number) => Math.round(n).toLocaleString('en-GB');

/** A file size as people read it — used by the data room and both portals. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
