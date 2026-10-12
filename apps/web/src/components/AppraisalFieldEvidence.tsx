import { trpc } from '../lib/trpc';
import { Button } from './ui';

/** Saved field observations are review context, not accepted financial inputs. */
export function AppraisalFieldEvidence({ dealId }: { dealId: string }) {
  const tasks = trpc.tasks.list.useQuery({ dealId, aspect: 'Field inspection' });
  const inspection = trpc.inspections.get.useQuery(dealId);
  return <section aria-label="Field evidence for appraisal" className="mt-5 rounded-card border border-border-std bg-surface p-4">
    <h2 className="text-[15px] font-semibold">Field evidence for appraisal</h2>
    <p className="mt-1 text-[12px] text-ink-2">Review site observations before changing assumptions. Completing a follow-up does not approve this appraisal or apply a financial adjustment.</p>
    {tasks.isError ? <p role="status" className="mt-3 text-[12px]">Field evidence could not be loaded. Its review status is unknown.</p> : tasks.isLoading ? <p role="status" className="mt-3 text-[12px]">Loading field evidence…</p> : !tasks.data?.length ? <p className="mt-3 text-[12px] text-ink-2">No field follow-ups are recorded for this project. This does not confirm that an inspection was completed.</p> : <details className="mt-3 text-[12px]">
      <summary className="cursor-pointer font-semibold">{tasks.data.filter(task => !task.done).length} open · {tasks.data.length} field follow-ups — review observations</summary>
      <ul className="mt-3 space-y-3">
        {tasks.data.map(task => <li key={task.id} className="rounded-lg bg-sunken p-3">
          <p className="font-semibold break-words">{task.title}</p>
          <p className="mt-1">{task.done ? 'Follow-up completed — appraisal impact still requires review.' : 'Open follow-up — consider whether it affects this appraisal.'}</p>
          {task.inspectionEvidenceState === 'unreadable' ? <p className="mt-2 text-ink-2">The captured inspection evidence could not be read. Verify the source before relying on this follow-up.</p> : task.inspectionEvidence ? <>
            <p className="mt-2 break-words">{task.inspectionEvidence.room.name} · {task.inspectionEvidence.room.condition ? `condition ${task.inspectionEvidence.room.condition}/5` : 'not rated'}</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{task.inspectionEvidence.room.notes || 'No note recorded.'}</p>
            <p className="mt-1 text-ink-2">Captured from the inspection saved {new Date(task.inspectionEvidence.sourceUpdatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (London time). Photos are not included.</p>
            {inspection.isError ? <p className="mt-1">The current inspection could not be checked.</p> : inspection.isLoading ? <p className="mt-1">Checking the current inspection…</p> : !inspection.data ? <p className="mt-1">The current inspection is unavailable. This captured observation remains historical context.</p> : (inspection.data.id !== task.inspectionEvidence.inspectionId || new Date(inspection.data.updatedAt).toISOString() !== task.inspectionEvidence.sourceUpdatedAt) ? <p className="mt-1 font-semibold">The current inspection differs from this captured version. Review the latest inspection before relying on this observation.</p> : null}
          </> : <p className="mt-2 text-ink-2">No inspection snapshot was captured for this task. Check the source with the colleague responsible.</p>}
        </li>)}
      </ul>
      <p className="mt-3 text-ink-2">These observations are not pinned to this appraisal version or included in its source input acknowledgement or report. Record any resulting assumptions through the appraisal review workflow.</p>
    </details>}
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" className="min-h-11" to={`/field?dealId=${encodeURIComponent(dealId)}`}>Open project field companion</Button>
      <Button size="sm" variant="ghost" className="min-h-11" onClick={() => { void tasks.refetch(); void inspection.refetch(); }}>Refresh field evidence</Button>
    </div>
  </section>;
}
