/** Local recovery only. Server authorisation and optimistic concurrency still apply. */
export type FieldDraft = {
  rooms: Array<{ name: string; condition: number; notes: string; photos: string[] }>;
  weights: { salesComparison: number; cost: number; income: number };
  value: number | null;
  held: string | null;
};
export const fieldDraftKey = (userId: string, dealId: string) =>
  `plotmerit-field-draft-v1:${encodeURIComponent(userId)}:${encodeURIComponent(dealId)}`;
export function parseFieldDraft(raw: string): FieldDraft {
  const d = JSON.parse(raw);
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!d || !Array.isArray(d.rooms) || !d.rooms.every((r: any) => r && typeof r.name === 'string'
    && finite(r.condition) && r.condition >= 0 && r.condition <= 5 && typeof r.notes === 'string'
    && Array.isArray(r.photos) && r.photos.every((p: unknown) => typeof p === 'string'))
    || !d.weights || !['salesComparison', 'cost', 'income'].every(k => finite(d.weights[k]) && d.weights[k] >= 0 && d.weights[k] <= 100)
    || !(d.value === null || (finite(d.value) && d.value >= 0))
    || !(d.held === null || (typeof d.held === 'string' && Number.isFinite(Date.parse(d.held))))) {
    throw new Error('Invalid field draft');
  }
  return { rooms: d.rooms, weights: d.weights, value: d.value, held: d.held };
}
export const fieldDraftContent = (d: Pick<FieldDraft, 'rooms' | 'weights' | 'value'>) =>
  JSON.stringify({ rooms: d.rooms, weights: d.weights, value: d.value });
