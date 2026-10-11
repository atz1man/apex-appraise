import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import { downloadReport } from '../lib/download';
import { useToast } from './Toast';
import { Button } from './ui';

/** One busy/retry/error contract for every internal PDF download action. */
export function ReportDownloadButton({
  kind,
  path,
  dealId,
  variant = 'primary',
  disabled = false,
}: {
  kind: 'appraisal' | 'redbook' | 'engagement' | 'portfolio';
  path: string;
  dealId?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const mint = trpc.appraisal.downloadToken.useMutation({
    meta: { inlineError: true },
  });
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const download = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      await downloadReport(mint.mutateAsync, kind, path, dealId, controller.signal);
      if (mounted.current) toast.success('PDF download started');
    } catch (error) {
      if (mounted.current)
        toast.error(
          controller.signal.aborted
            ? 'The download took too long. Try again, or use Print / Save PDF.'
            : error instanceof Error
              ? error.message
              : 'The PDF could not be downloaded. Please try again.',
        );
    } finally {
      clearTimeout(timeout);
      active.current = null;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <Button variant={variant} loading={pending} disabled={disabled} onClick={() => void download()}>
      {pending ? 'Preparing PDF…' : 'Download PDF'}
    </Button>
  );
}
