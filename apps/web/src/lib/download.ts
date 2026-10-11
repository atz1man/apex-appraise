/** Fetch a scoped PDF before downloading so server failures stay in the workfile. */
export async function downloadReport(
  mint: (input: {
    kind: 'appraisal' | 'redbook' | 'engagement' | 'portfolio';
    dealId?: string;
  }) => Promise<{ token: string }>,
  kind: 'appraisal' | 'redbook' | 'engagement' | 'portfolio',
  path: string,
  dealId?: string,
  signal?: AbortSignal,
) {
  const { token } = await mint({ kind, dealId });
  const response = await fetch(`${path}?t=${encodeURIComponent(token)}`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your sign-in changed. Reload the page and try again.');
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'The PDF could not be downloaded. Try again, or use Print / Save PDF.');
  }
  if (!response.headers.get('content-type')?.includes('application/pdf'))
    throw new Error('The server did not return a PDF. Try again, or use Print / Save PDF.');
  const blob = await response.blob();
  if ((await blob.slice(0, 4).text()) !== '%PDF') throw new Error('The PDF response was incomplete. Please try again.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const filename = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1];
  link.download = filename || `${kind}-report.pdf`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Leave enough time for the browser to consume the download, then reclaim it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
