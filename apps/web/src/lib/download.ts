/**
 * Open a report PDF in a new tab.
 *
 * The tab is opened SYNCHRONOUSLY, inside the click, and pointed at the document
 * once the token arrives. Fetching first and opening after would be simpler to
 * read and would be blocked as a popup, because by then the browser no longer
 * considers the navigation to be something the user asked for.
 *
 * The token is minted per download and lasts two minutes — see
 * apps/api/src/download-token.ts for why the URL must not carry a session.
 */
export async function openReport(
  mint: (input: { kind: 'appraisal' | 'redbook' | 'engagement' | 'portfolio'; dealId?: string }) => Promise<{ token: string }>,
  kind: 'appraisal' | 'redbook' | 'engagement' | 'portfolio',
  path: string,
  dealId?: string,
) {
  const tab = window.open('', '_blank');
  try {
    const { token } = await mint({ kind, dealId });
    const url = `${path}?t=${encodeURIComponent(token)}`;
    if (tab) tab.location.href = url;
    else window.location.href = url; // popup blocked outright — go in place
  } catch (e) {
    // never leave a blank tab sitting there as if something were loading
    tab?.close();
    throw e;
  }
}
