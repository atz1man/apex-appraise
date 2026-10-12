import { useState } from 'react';
import { getPrincipal, trpc } from '../lib/trpc';
import { firmDayKey, firmDayLabel } from '../lib/firm-day';
import { useUnsavedWarning } from '../lib/unsaved';
import { Button, writeAttrs } from './ui';

/** Human-reviewed tasks from saved observations. The task holds the reviewed
 * title and a server-captured observation snapshot; no appraisal is changed. */
export function FieldFollowups({ dealId }: { dealId: string }) {
  const utils = trpc.useUtils();
  const inspection = trpc.inspections.get.useQuery(dealId);
  const members = trpc.org.members.useQuery();
  const tasks = trpc.tasks.list.useQuery({ dealId, aspect: 'Field inspection' });
  const [draft, setDraft] = useState<{ observation: string; title: string; assignee: string; due: string; source?: { inspectionId: string; updatedAt: string; roomIndex: number }; edit?: { id: string; title: string; assignee: string; assigneeId: string | null; due: string | null; done: boolean } } | null>(null);
  const [notice, setNotice] = useState('');
  const [submission, setSubmission] = useState<Parameters<ReturnType<typeof trpc.tasks.create.useMutation>['mutate']>[0] | null>(null);
  useUnsavedWarning(!!draft, 'this field follow-up');
  const create = trpc.tasks.create.useMutation({
    onSuccess: () => { setDraft(null); setSubmission(null); setNotice('Follow-up created in this project and the calendar.'); },
    onSettled: () => { void utils.tasks.list.invalidate(); },
  });
  const update = trpc.tasks.update.useMutation({
    onSuccess: () => { setDraft(null); setNotice('Follow-up updated in this project and the calendar.'); },
    onSettled: () => { void utils.tasks.list.invalidate(); },
  });
  const pending = create.isPending || update.isPending;
  const toggle = trpc.tasks.toggle.useMutation({ onSuccess: () => { void utils.tasks.list.invalidate(); } });
  const title = draft?.title.trim() ?? '';
  const availableMembers = members.data ?? [];
  const assigneeValid = !!draft && !members.isError && !members.isLoading && availableMembers.some(member => member.id === draft.assignee);
  const duplicate = tasks.data?.some(task => task.id !== draft?.edit?.id && (!submission || task.createRequestId !== submission.createRequestId) && task.title === title && !task.done) ?? false;
  const observations = inspection.data?.rooms.map((room, roomIndex) => ({ ...room, roomIndex })).filter(room => room.notes.trim() || room.condition > 0) ?? [];
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
              <Button size="sm" variant="secondary" className="mt-2 min-h-11" disabled={!!draft || pending} onClick={() => {
                setNotice(''); create.reset();
                setDraft({ assignee: getPrincipal()?.userId ?? '', due: '', source: { inspectionId: inspection.data!.id, updatedAt: new Date(inspection.data!.updatedAt).toISOString(), roomIndex: room.roomIndex }, observation: `${room.name}: ${room.notes || `Condition ${room.condition}/5; no note recorded.`}`, title: `Review ${room.name}: ${room.notes.trim().slice(0, 180) || `condition ${room.condition}/5`}` });
              }}>Review follow-up for {room.name}</Button>
            </div>
          ))}
        </div>
      )}
      {draft && (
        <form className="mt-4 space-y-3" onSubmit={event => {
          event.preventDefault();
          if (submission) { if (!pending) create.mutate(submission); return; }
          if (!title || duplicate || pending || tasks.isError || tasks.isLoading || !assigneeValid) return;
          if (draft.edit) {
            const { id, ...expected } = draft.edit;
            const originalDay = expected.due ? firmDayKey(expected.due) : '';
            update.mutate({ id, title, assigneeId: draft.assignee, expected, ...(draft.due !== originalDay ? { due: draft.due || null } : {}) });
          } else {
            const request = { createRequestId: crypto.randomUUID(), dealId, aspect: 'Field inspection', title, inspectionSource: draft.source, assigneeId: draft.assignee, due: draft.due || undefined };
            setSubmission(request); create.mutate(request);
          }
        }}>
          <p className="text-[12px] whitespace-pre-wrap break-words">{draft.edit ? 'Editing an existing follow-up. Completion status stays unchanged.' : `Observation selected for review: ${draft.observation}`}</p>
          <label className="block text-[12px] font-semibold">Follow-up title
            <textarea {...writeAttrs()} disabled={pending || !!submission} value={draft.title} maxLength={240} required rows={3} className="mt-1 block w-full rounded-lg border border-border-std bg-surface p-2 text-[13px]" onChange={event => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="block text-[12px] font-semibold">Assign follow-up to
            <select {...writeAttrs()} value={availableMembers.some(member => member.id === draft.assignee) ? draft.assignee : ''} required disabled={pending || !!submission || members.isLoading || members.isError} className="mt-1 block min-h-11 w-full rounded-lg border border-border-std bg-surface p-2 text-[13px]" onChange={event => setDraft({ ...draft, assignee: event.target.value })}>
              <option value="">Choose a colleague</option>
              {(members.data ?? []).map(member => <option key={member.id} value={member.id}>{member.name} ({member.initials})</option>)}
            </select>
          </label>
          {members.isError ? <p role="status" className="text-[12px]">Workspace members could not be loaded. <Button variant="ghost" size="sm" onClick={() => { void members.refetch(); }}>Retry members</Button></p> : members.isLoading ? <p role="status" className="text-[12px]">Loading workspace members…</p> : !assigneeValid ? <p role="status" className="text-[12px]">Choose a current member before saving the follow-up.</p> : null}
          <label className="block text-[12px] font-semibold">Follow-up due date
            <input {...writeAttrs()} type="date" disabled={pending || !!submission} value={draft.due} className="mt-1 block min-h-11 w-full rounded-lg border border-border-std bg-surface p-2 text-[13px]" onChange={event => setDraft({ ...draft, due: event.target.value })} />
          </label>
          <p className="text-[11px] text-ink-2">{draft.edit ? 'Clear the date to remove the deadline.' : 'Leave the date blank for seven days from creation.'} The saved note and condition are captured when this follow-up is created. Photos and financial figures are not copied; later inspection changes do not rewrite the captured evidence.</p>
          {duplicate && <p role="status" className="text-[12px]">An open follow-up already has this title.</p>}
          {update.isError && <p role="alert" className="text-[12px]">{update.error.data?.code === 'CONFLICT' ? 'This follow-up changed elsewhere. Your draft is retained. Refresh follow-ups to review the latest saved task below; cancel and reopen editing when ready.' : 'The update could not be confirmed. Your draft is retained. Refresh follow-ups to check the saved task before retrying.'}</p>}
          {create.isError && <p role="alert" className="text-[12px]">{create.error.data?.code === 'CONFLICT' ? 'The saved inspection changed. Your draft is retained. Copy any title you need, cancel, refresh observations and select the latest observation before creating the task.' : 'The follow-up could not be confirmed. Retry this unchanged submission safely: if it was saved, the original task will be returned. Refresh to check the task list before cancelling or starting again.'}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" writes className="min-h-11" loading={pending} disabled={!submission && (!title || duplicate || tasks.isError || tasks.isLoading || !assigneeValid)}>{draft.edit ? 'Save follow-up changes' : 'Create project follow-up'}</Button>
            <Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => { setDraft(null); setSubmission(null); create.reset(); update.reset(); }}>Cancel follow-up</Button>
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
              <p className="mt-1 text-[11px] text-ink-2">{task.done ? 'Completed' : 'Open'} · {availableMembers.find(member => member.id === task.assigneeId)?.name ?? (members.isLoading ? task.assignee : `${task.assignee} (${task.assigneeId ? 'member unavailable' : 'legacy assignment; select a colleague when editing'})`)}{task.due ? ` · due ${firmDayLabel(task.due)}` : ''}</p>
              {task.inspectionEvidence ? <details className="mt-2 text-[12px]">
                <summary className="cursor-pointer">Captured inspection evidence</summary>
                <p className="mt-2 break-words">{task.inspectionEvidence.room.name} · {task.inspectionEvidence.room.condition ? `condition ${task.inspectionEvidence.room.condition}/5` : 'not rated'}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{task.inspectionEvidence.room.notes || 'No note recorded.'}</p>
                <p className="mt-1 text-ink-2">Inspection saved {new Date(task.inspectionEvidence.sourceUpdatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (London time). Photos are not included.</p>
                {inspection.data && (inspection.data.id !== task.inspectionEvidence.inspectionId || new Date(inspection.data.updatedAt).toISOString() !== task.inspectionEvidence.sourceUpdatedAt) && <p className="mt-1">The current inspection differs from this captured version. Review it before relying on this observation.</p>}
                {inspection.isError && <p className="mt-1">The current inspection could not be checked.</p>}
              </details> : <p className="mt-2 text-[11px] text-ink-2">No inspection snapshot was captured for this task.</p>}
              <Button size="sm" variant="secondary" className="mt-2 mr-2 min-h-11" disabled={!!draft || pending || toggle.isPending} onClick={() => {
                setNotice(''); update.reset(); create.reset();
                setDraft({ observation: '', title: task.title, assignee: task.assigneeId ?? '', due: task.due ? firmDayKey(task.due) : '', edit: { id: task.id, title: task.title, assignee: task.assignee, assigneeId: task.assigneeId, due: task.due ? new Date(task.due).toISOString() : null, done: task.done } });
              }}>Edit follow-up</Button>
              <Button writes size="sm" variant="secondary" className="mt-2 min-h-11" disabled={!!draft || pending || toggle.isPending} onClick={() => toggle.mutate({ id: task.id, done: !task.done })}>{task.done ? 'Reopen follow-up' : 'Complete follow-up'}</Button>
            </li>)}
          </ul>
        )}
        {toggle.isError && <p role="alert" className="mt-2 text-[12px]">The status change could not be confirmed. Refresh follow-ups to check the saved status.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => { void tasks.refetch(); void inspection.refetch(); void members.refetch(); }}>Refresh follow-ups</Button>
          <Button to="/calendar" size="sm" variant="secondary" className="min-h-11">Open task calendar</Button>
          <Button to={`/deal/${dealId}/workbench`} size="sm" variant="secondary" className="min-h-11">Review current inspection</Button>
        </div>
      </div>
    </section>
  );
}
