/**
 * Receiving an order email shared from another app.
 *
 * The Add screen teaches this in three steps — open the order, tap share,
 * pick kept — and until now nothing behind it was listening. A PWA share
 * target delivers the shared content as query parameters, which is all this
 * needs: no service worker in the path, so it survives a cold start.
 *
 * The sharing app decides how to split what it sends. Mail clients vary: some
 * put the subject in `title` and the body in `text`, some send everything as
 * `text`, some add a `url`. All three are folded together, because the parser
 * wants the whole thing and the subject line is often where the shop's name
 * actually appears.
 */
export function sharedTextFrom(params: URLSearchParams): string | null {
  const parts = ['title', 'text', 'url']
    .map((k) => params.get(k))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (parts.length === 0) return null;
  // Deduplicated: Android often sends the same string as both text and url,
  // and a doubled total is exactly the kind of thing that confuses a parser
  // looking for the largest amount on the page.
  return [...new Set(parts.map((p) => p.trim()))].join('\n');
}

/** The query keys a share can arrive under, for stripping them afterwards. */
export const SHARE_PARAMS = ['title', 'text', 'url'] as const;
