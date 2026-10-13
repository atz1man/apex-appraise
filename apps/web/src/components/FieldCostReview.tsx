import { useEffect, useMemo, useState } from 'react';
import { computeAppraisal, type AppraisalInput } from '@apex/appraisal-engine';
import type { FieldSnapshotExport } from '../lib/field-snapshot-export';
import { fM } from '../lib/format';
import { useUnsavedWarning } from '../lib/unsaved';
import { Button, writeAttrs } from './ui';

export function FieldCostReview({ input, snapshot, blocked, pending, error, onSave, onDraftChange }: {
  input: AppraisalInput; snapshot: FieldSnapshotExport; blocked: boolean; pending: boolean; error?: string;
  onDraftChange: (dirty: boolean) => void;
  onSave: (input: AppraisalInput, review: { taskId: string; cost: { label: string; amount: number }; reason: string; accepted: true }) => void;
}) {
  const [taskId, setTaskId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const draftDirty = !!(taskId || label || amount || reason);
  useUnsavedWarning(draftDirty, 'this field allowance review');
  useEffect(() => { onDraftChange(draftDirty); return () => onDraftChange(false); }, [draftDirty, onDraftChange]);
  const task = snapshot.tasks.find(item => item.id === taskId);
  const valid = !!task && !!label.trim() && Number(amount) > 0 && Number(amount) <= 1e10 && /^\d+(\.\d{1,2})?$/.test(amount) && reason.trim().length >= 10;
  const proposed = useMemo(() => valid ? { ...input, otherCosts: [...input.otherCosts, { label: label.trim(), amount: Number(amount) }] } : null, [input, valid, label, amount]);
  const preview = useMemo(() => proposed ? computeAppraisal(proposed, { withCash: true }) : null, [proposed]);
  return <section aria-label="Review field allowance" className="mt-5 rounded-card border border-border-std bg-surface p-4">
    <h2 className="text-[15px] font-semibold">Review field allowance</h2>
    <p className="mt-2 text-sm">Link a manually assessed allowance to a captured observation. Saves a new appraisal version using the existing cost profile. This is a historical review, not professional approval; check the latest inspection before relying on it.</p>
    {blocked && <p role="status" className="mt-2 text-sm">Save or reload this appraisal before reviewing an allowance.</p>}
    <fieldset disabled={pending || blocked} className="mt-3 grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Field allowance details</legend>
      <label className="text-sm">Captured field task<select aria-label="Captured field task" className="mt-1 block w-full rounded border border-border-std bg-surface p-2" value={taskId} onChange={e => { setTaskId(e.target.value); setAccepted(false); }}><option value="">Choose an observation</option>{snapshot.tasks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="text-sm">Allowance label<input aria-label="Allowance label" className="mt-1 block w-full rounded border border-border-std bg-surface p-2" value={label} maxLength={160} onChange={e => { setLabel(e.target.value); setAccepted(false); }} /></label>
      <label className="text-sm">Allowance amount (£)<input aria-label="Allowance amount" className="mt-1 block w-full rounded border border-border-std bg-surface p-2" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setAccepted(false); }} /></label>
      <label className="text-sm">Review rationale<textarea aria-label="Review rationale" className="mt-1 block w-full rounded border border-border-std bg-surface p-2" value={reason} maxLength={2000} onChange={e => { setReason(e.target.value); setAccepted(false); }} /></label>
    </fieldset>
    {task && <p className="mt-3 whitespace-pre-wrap text-sm">Captured observation: {task.inspectionEvidence?.room.notes || 'No inspection note captured. Verify the source before relying on this task.'}</p>}
    {preview && <p role="status" className="mt-3 text-sm">Engine preview with allowance: residual land {fM(preview.residualNet)} · profit {fM(preview.profit)}</p>}
    <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" {...writeAttrs()} disabled={pending} checked={accepted} onChange={e => setAccepted(e.target.checked)} />I reviewed the source, amount and rationale. This does not professionally approve the appraisal.</label>
    <Button writes className="mt-3 min-h-11" loading={pending} disabled={blocked || !valid || !accepted} onClick={() => { if (proposed && task && accepted) onSave(proposed, { taskId, cost: { label: label.trim(), amount: Number(amount) }, reason: reason.trim(), accepted: true }); }}>Save reviewed allowance version</Button>
    {draftDirty && <Button variant="ghost" className="mt-3 min-h-11" disabled={pending} onClick={() => { setTaskId(''); setLabel(''); setAmount(''); setReason(''); setAccepted(false); }}>Discard allowance draft</Button>}
    {error && <p role="alert" className="mt-2 text-sm">{error} If the response was lost, reload the appraisal to check whether the new version was saved before trying again.</p>}
  </section>;
}
