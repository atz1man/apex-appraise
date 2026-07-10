import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

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
  success: { border: '#BFE0CD', dot: '#1E7A55' },
  error: { border: '#F9EAE7', dot: '#B23A2E' },
  info: { border: '#E5EAF6', dot: '#2D5BA8' },
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

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[340px] max-w-[90vw]">
        {toasts.map((t) => {
          const s = KIND_STYLE[t.kind];
          return (
            <div
              key={t.id}
              className="bg-surface rounded-card shadow-float px-4 py-3 flex items-start gap-2.5 animate-slideIn"
              style={{ border: `1px solid ${s.border}` }}
              role="status"
            >
              <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: s.dot }} />
              <span className="text-[12.5px] leading-snug text-ink">{t.message}</span>
              <button
                className="ml-auto text-ink-3 hover:text-ink text-[15px] leading-none"
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
