import { useEffect, useRef, useState } from 'react';
import type { ExportOpts } from '../lib/exportXlsx';
import { Button } from './ui';

/** Keep export failures visible and retain the editor inputs for a retry. */
export function WorkbookDownloadButton({ options }: { options: ExportOpts }) {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => () => { active.current?.abort(); }, []);
  const download = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError(false);
    setPending(true);
    try {
      const { exportAppraisalXlsx } = await import('../lib/exportXlsx');
      if (!controller.signal.aborted) await exportAppraisalXlsx(options, controller.signal);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return <div className="hidden sm:block">
    <Button variant="secondary" loading={pending} onClick={() => void download()}>
      {pending ? 'Preparing Excel…' : 'Export .xlsx'}
    </Button>
    {error && <p role="alert" className="mt-2 max-w-xs text-[12px] text-status-red">Excel export failed. Your inputs are unchanged. Select Export .xlsx to try again.</p>}
  </div>;
}
