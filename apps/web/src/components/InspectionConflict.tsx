import { Button } from './ui';

/** Keep the rejected draft separate from the current record: recovery never retries
 * with a fresh timestamp or silently merges professional observations. */
export function InspectionConflict({ dealId, latestUrl, draft }: {
  dealId: string;
  latestUrl: string;
  draft: unknown;
}) {
  const download = () => {
    const blob = new Blob([JSON.stringify({
      format: 'apex-inspection-draft-v1', dealId, exportedAt: new Date().toISOString(),
      notice: 'Unsaved draft for manual review. Photo references only; image files and queued photos are not included.',
      draft,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inspection-draft-${dealId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div role="alert" className="my-3 scroll-mt-20 rounded-xl border border-line bg-surface p-4 text-[13px]">
      <p className="font-semibold">A newer inspection has been saved</p>
      <p className="mt-2">Your draft is still here, but has not been saved. Download it before closing this tab. Open the latest version in a new tab, compare your changes and enter only the changes you want to keep there.</p>
      <p className="mt-2 text-ink-2">The download contains notes, values and photo references, not image files or queued photos. It is for manual review, not automatic import.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button className="min-h-11" onClick={download}>Download my draft</Button>
        <a className="inline-flex min-h-11 items-center underline text-brand-ink" href={latestUrl} target="_blank" rel="noopener noreferrer">Open latest in new tab</a>
      </div>
    </div>
  );
}
