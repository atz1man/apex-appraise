import type { DeadlineAlert } from '../lib/alerts';

/**
 * Delivering an alert on this platform, and being straight about the limits.
 *
 * A web app cannot wake itself at 9am to tell you about a coat. Notification
 * Triggers never shipped, and Periodic Background Sync is one engine's, only
 * for installed apps, and granted at the browser's discretion. So the honest
 * contract is: alerts are computed whenever kept is opened or brought back to
 * the foreground, and the Settings screen says exactly that rather than
 * implying a background service that does not exist. The engine in
 * lib/alerts.ts is where the decisions live and does not care how they are
 * delivered — when a native shell or a push path arrives, only this file
 * changes.
 */

export type NotifyState = 'unsupported' | 'default' | 'granted' | 'denied';

/** At most this many at once — an app that stacks up notifications gets muted. */
const MAX_PER_WAKE = 3;

export function notifyState(): NotifyState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyState;
}

/** True when this is the landing page's embedded demo rather than the real app. */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin frame throws on the comparison, which is itself the answer.
    return true;
  }
}

export async function requestNotifyPermission(): Promise<NotifyState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  // Permission prompts are blocked in frames, and the marketing page's demo
  // has no business asking for one.
  if (isEmbedded()) return notifyState();
  try {
    return (await Notification.requestPermission()) as NotifyState;
  } catch {
    return notifyState();
  }
}

/**
 * Shows the alerts and returns the ones actually delivered, so the caller
 * records exactly what was said. Anything beyond the cap is left unrecorded
 * and comes up again next time, rather than being silently swallowed.
 */
export async function deliver(alerts: readonly DeadlineAlert[]): Promise<DeadlineAlert[]> {
  if (notifyState() !== 'granted' || isEmbedded()) return [];
  const batch = alerts.slice(0, MAX_PER_WAKE);
  if (batch.length === 0) return [];

  // The service worker's notifications survive the tab closing and can be
  // clicked back into the app; the constructor is the fallback where no
  // worker is registered.
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker?.ready;
  } catch {
    registration = undefined;
  }

  const shown: DeadlineAlert[] = [];
  for (const a of batch) {
    const options: NotificationOptions = {
      body: a.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Keyed per receipt+rung so a repeat can only ever replace its own
      // notification, never pile a second one on top.
      tag: a.key,
      data: { receiptId: a.receiptId },
    };
    try {
      if (registration) await registration.showNotification(a.title, options);
      else new Notification(a.title, options);
      shown.push(a);
    } catch {
      // A refused notification is not worth taking the app down for, and an
      // undelivered alert stays unrecorded so it can be tried again.
    }
  }
  return shown;
}
