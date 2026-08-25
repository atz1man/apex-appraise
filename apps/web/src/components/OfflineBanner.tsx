import { useEffect, useState } from 'react';
import { onlineManager, useIsMutating } from '@tanstack/react-query';

/**
 * No signal.
 *
 * The field app is used on sites with no reception — that is the reason the
 * service worker precaches the shell and the typefaces. What nothing said is
 * what happens when a surveyor presses Save out there.
 *
 * react-query's default network mode PAUSES a mutation while the browser
 * reports offline rather than failing it, and replays it on reconnect. That is
 * exactly the right behaviour and it works: measured in a browser, an invite
 * sent with the network cut fired and succeeded the moment it came back.
 *
 * But a paused mutation raises no error, so the global handler that exists so
 * there are "no more silent failures" never runs, and nothing at all appears.
 * The surveyor taps Save, sees nothing change, and taps again — and every tap
 * queues another write that replays on reconnect. Silence read as failure, and
 * the response to it made duplicates.
 *
 * So: say it. The bar states the two things a person on a roof needs to know —
 * their work is held, and it will go when the signal does.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  /**
   * Subscribed through react-query's own onlineManager rather than to the
   * window events directly, so this bar and the thing that actually pauses the
   * writes can never disagree about whether we are offline.
   */
  useEffect(() => onlineManager.subscribe(setOnline), []);

  /** Paused writes are counted as pending; this is how many are waiting. */
  const waiting = useIsMutating();

  if (online) return null;

  /**
   * In the document flow, not fixed over it.
   *
   * The first version was `fixed top-0 z-[110]`, which covered the TopBar —
   * sticky at top-0 and 56px tall — including the brand lockup and the
   * breadcrumb. Measured with elementFromPoint: the bar was on top of the header
   * at its middle, not merely its edge. Hiding the navigation exactly when
   * somebody is offline and trying to get back to a screen that still works is a
   * bad trade for a notice.
   *
   * So it pushes the page down instead, and the TopBar below it goes on
   * sticking to the top of the viewport once you scroll past. The layout shift
   * when it appears is the honest version of the signal.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-2 text-center text-[12.5px] font-medium bg-status-amber-bg text-status-amber border-b border-border-strong"
    >
      No signal — your work is held on this device{waiting > 0 ? ` (${waiting} waiting)` : ''} and will be sent when you
      are back online.
    </div>
  );
}
