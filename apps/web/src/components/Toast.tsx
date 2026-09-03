import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { neutral } from '@apex/ui-tokens';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

/** Module-level hook for non-React callers (the global mutation error handler). */
let globalPush: ToastApi['push'] | null = null;
export const toastGlobal = (kind: ToastKind, message: string) => globalPush?.(kind, message);

const KIND_STYLE: Record<ToastKind, { border: string; dot: string }> = {
  success: { border: neutral.borderGreenSoft, dot: 'rgb(var(--status-green, 30 122 85))' },
  error: { border: 'rgb(var(--status-red-bg, 249 234 231))', dot: 'rgb(var(--status-red, 178 58 46))' },
  info: { border: 'rgb(var(--status-blue-bg, 229 234 246))', dot: 'rgb(var(--status-blue, 45 91 168))' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ push, success: (m) => push('success', m), error: (m) => push('error', m) }),
    [push],
  );
  globalPush = push;

  const card = (t: Toast) => {
    const s = KIND_STYLE[t.kind];
    return (
      <div
        key={t.id}
        data-testid="toast"
        className="bg-surface rounded-card shadow-float px-4 py-3 flex items-start gap-2.5 animate-slideIn"
        style={{ border: `1px solid ${s.border}` }}
      >
        <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: s.dot }} aria-hidden="true" />
        <span className="text-[12.5px] leading-snug text-ink">{t.message}</span>
        {/* "×" is text, so it counts as a name and reads as "multiplication sign" */}
        <button
          className="ml-auto text-ink-3 hover:text-ink text-[15px] leading-none"
          aria-label="Dismiss notification"
          onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        This is the whole product's feedback channel. Every mutation reports
        through it — saved, refused, removed, invited, "Couldn't load this
        page's data" — and for anyone not looking at the bottom-right corner of
        the screen it was silent.

        The markup LOOKED right: each toast carried `role="status"`. The catch
        is that a live region has to be in the document BEFORE the message
        arrives. A `role="status"` element that is itself inserted along with
        its text is the documented way NOT to be announced — the assistive
        technology has no region to be watching. So the regions below are always
        mounted, empty, from the moment the app starts, and the messages arrive
        into them.

        Two of them, because politeness is not one setting. A success waits for
        a gap in what is being read; "Couldn't load this page's data" should
        not queue behind a table being narrated. Errors are the assertive one,
        which is also why they are a separate list rather than a flag on the
        card: an `aria-live` value is a property of the REGION.
      */}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[340px] max-w-[90vw]">
        <div className="flex flex-col gap-2" aria-live="assertive" aria-relevant="additions">
          {toasts.filter((t) => t.kind === 'error').map(card)}
        </div>
        <div className="flex flex-col gap-2" aria-live="polite" aria-relevant="additions">
          {toasts.filter((t) => t.kind !== 'error').map(card)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
