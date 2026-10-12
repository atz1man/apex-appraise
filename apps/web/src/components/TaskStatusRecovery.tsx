import { Button } from './ui';

/** An uncertain write is not an unchanged task. Retry the original mutation
 * variables, never derive a fresh target from a refreshed task list. */
export function TaskStatusRecovery({ pending, onRetry, onRefresh, onDismiss }: {
  pending: boolean; onRetry: () => void; onRefresh: () => void; onDismiss: () => void;
}) {
  return <div role="alert" className="my-3 rounded-lg border border-border-std bg-sunken p-3 text-[12px]">
    <p>The task status change could not be confirmed. Refresh tasks to check the saved status. Retrying sends the same requested status; it does not reverse the task.</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button writes size="sm" variant="secondary" className="min-h-11" disabled={pending} onClick={onRetry}>Retry status change</Button>
      <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={onRefresh}>Refresh task status</Button>
      <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={onDismiss}>Dismiss status warning</Button>
    </div>
  </div>;
}
