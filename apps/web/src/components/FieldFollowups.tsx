import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { firmDayLabel } from '../lib/firm-day';
import { useUnsavedWarning } from '../lib/unsaved';
import { Button, writeAttrs } from './ui';

/** Human-reviewed tasks from saved observations. The task holds the reviewed
 * title only; the inspection remains the evidence, and no appraisal is changed. */
export function FieldFollowups({ dealId }: { dealId: string }) {
  const utils = trpc.useUtils();
  const inspection = trpc.inspections.get.useQuery(dealId);
  const tasks = trpc.tasks.list.useQuery({ dealId, aspect: 'Field inspection' });
  const [draft, setDraft] = useState<{ observation: string; title: string } | null>(null);
  const [notice, setNotice] = useState('');
  useUnsavedWarning(!!draft, 'this field follow-up');
  const create = trpc.tasks.create.useMutation({
    onSuccess: () => { setDraft(null); setNotice('Follow-up created in this project and the calendar.'); },
    onSettled: () => { void utils.tasks.list.invalidate(); },
  });
  const toggle = trpc.tasks.toggle.useMutation({ onSuccess: () => { void utils.tasks.list.invalidate(); } });
  const title = draft?.title.trim() ?? '';
  const duplicate = tasks.data?.some(task => task.title === title && !task.done) ?? false;
  const observations = inspection.data?.rooms.filter(room => room.notes.trim() || room.condition > 0) ?? [];
  return (
    <section aria-label="Field follow-ups" className="mx-[18px] my-4 rounded-card border border-border-std bg-surface p-4">
      <h2 className="text-[15px] font-semibold">Field follow-ups</h2>
      <p className="mt-1 text-[12px] text-ink-2">Turn saved observations into reviewed project tasks. Save inspection edits first. Tasks do not change appraisal figures.</p>
      {inspection.isError ? (
        <div role="status" className="mt-3 text-[12px]">Saved observations could not be loaded. <Button size="sm" variant="ghost" onClick={() => { void inspection.refetch(); }}>Retry observations</Button></div>
      ) : inspection.isLoading ? <p role="status" className="mt-3 text-[12px]">Loading saved observations…</p> : (
        <div className="mt-3 space-y-3">
          {!observations.length && <p className="text-[12px] text-ink-2">No saved notes or condition ratings yet.</p>}
          {observations.map((room, index) => (
            <div key={`${index}-${room.name}`} className="rounded-lg bg-sunken p-3">
              <p className="text-[12px] font-semibold">{room.name} · {room.condition ? `condition ${room.condition}/5` : 'not rated'}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px]">{room.notes || 'No saved note.'}</p>
              <Button size="sm" variant="secondary" className="mt-2 min-h-11" disabled={!!draft || create.isPending} onClick={() => {
                setNotice(''); create.reset();
                setDraft({ observation: `${room.name}: ${room.notes || `Condition ${room.condition}/5; no note recorded.`}`, title: `Review ${room.name}: ${room.notes.trim().slice(0, 180) || `condition ${room.condition}/5`}` });
              }}>Review follow-up for {room.name}</Button>
            </div>
          ))}
        </div>
      )}
      {draft && (
        <form className="mt-4 space-y-3" onSubmit={event => {
          event.preventDefault();
          if (title && !duplicate && !create.isPending && !tasks.isError && !tasks.isLoading) create.mutate({ dealId, aspect: 'Field inspection', title });
        }}>
          <p className="text-[12px] whitespace-pre-wrap break-words">Observation selected for review: {draft.observation}</p>
          <label className="block text-[12px] font-semibold">Follow-up title
            <textarea {...writeAttrs()} value={draft.title} maxLength={240} required rows={3} className="mt-1 block w-full rounded-lg border border-border-std bg-surface p-2 text-[13px]" onChange={event => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <p className="text-[11px] text-ink-2">Only this title is saved to the task. Assigned to you, due in seven days. Review the current inspection in the workbench for full evidence.</p>
          {duplicate && <p role="status" className="text-[12px]">An open follow-up already has this title.</p>}
          {create.isError && <p role="alert" className="text-[12px]">The follow-up could not be confirmed. Check the task list before trying again; your title is still here.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" writes className="min-h-11" loading={create.isPending} disabled={!title || duplicate || tasks.isError || tasks.isLoading}>Create project follow-up</Button>
            <Button variant="ghost" className="min-h-11" disabled={create.isPending} onClick={() => { setDraft(null); create.reset(); }}>Cancel follow-up</Button>
          </div>
        </form>
      )}
      {notice && <p role="status" className="mt-3 text-[12px]">{notice}</p>}
      <div className="mt-4 border-t border-border-std pt-3">
        <p className="text-[12px] font-semibold">Project follow-up status</p>
        {tasks.isError ? <p role="status" className="mt-2 text-[12px]">Follow-ups could not be loaded.</p> : tasks.isLoading ? <p role="status" className="mt-2 text-[12px]">Loading follow-ups…</p> : !tasks.data?.length ? <p className="mt-2 text-[12px] text-ink-2">No field follow-ups for this project yet.</p> : (
          <ul className="mt-2 space-y-3">
            {tasks.data.map(task => <li key={task.id} className="rounded-lg border border-border-std p-3">
              <p className="text-[12px] break-words">{task.title}</p>
              <p className="mt-1 text-[11px] text-ink-2">{task.done ? 'Completed' : 'Open'} · {task.assignee}{task.due ? ` · due ${firmDayLabel(task.due)}` : ''}</p>
              <Button writes size="sm" variant="secondary" className="mt-2 min-h-11" disabled={toggle.isPending} onClick={() => toggle.mutate(task.id)}>{task.done ? 'Reopen follow-up' : 'Complete follow-up'}</Button>
            </li>)}
          </ul>
        )}
        {toggle.isError && <p role="alert" className="mt-2 text-[12px]">The status change could not be confirmed. Refresh follow-ups to check the saved status.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => { void tasks.refetch(); void inspection.refetch(); }}>Refresh follow-ups</Button>
          <Button to="/calendar" size="sm" variant="secondary" className="min-h-11">Open task calendar</Button>
          <Button to={`/deal/${dealId}/workbench`} size="sm" variant="secondary" className="min-h-11">Review current inspection</Button>
        </div>
      </div>
    </section>
  );
}
