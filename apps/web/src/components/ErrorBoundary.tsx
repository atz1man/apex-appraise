import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getToken } from '../lib/trpc';
import { Button } from './ui';

/**
 * The last line before a white screen.
 *
 * There was no boundary at all: any render-time exception unmounted the whole
 * application and left a blank page. A blank page is the worst possible failure
 * message because it is indistinguishable from a network problem, a bad URL, or
 * the product simply being broken — and a valuer who sees one mid-instruction has
 * no idea whether their work was saved.
 *
 * This does not pretend to recover. It says what happened, offers the two things
 * that actually help, and tries to report the fault so it is not only the
 * customer who knows about it — saying which of those two it managed, rather
 * than claiming the report and hoping.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** what actually happened to the report — never assumed, only observed */
  reported: 'pending' | 'sent' | 'failed' | 'signed-out';
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reported: 'pending' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /**
     * Reported to the server's own error log — the same place server faults go —
     * so a screen that breaks for a customer shows up without them reporting it.
     * Failure to report must never make the failure worse, hence the catch.
     *
     * The endpoint is authenticated, so a crash on the landing, login or signing
     * pages cannot be recorded: a public write into a capped table is a way to
     * flush every real fault out of it with junk. That is a deliberate limit, and
     * the screen says which of the two happened rather than claiming the report
     * either way — this product does not get to assert things it has not checked.
     */
    if (!getToken()) {
      this.setState({ reported: 'signed-out' });
      return;
    }
    try {
      void fetch('/trpc/org.reportClientError', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${getToken() ?? ''}`,
        },
        body: JSON.stringify({
          json: {
            message: error.message.slice(0, 500),
            stack: (error.stack ?? '').slice(0, 2000),
            componentStack: (info.componentStack ?? '').slice(0, 2000),
            path: window.location.pathname,
          },
        }),
      })
        .then((r) => this.setState({ reported: r.ok ? 'sent' : 'failed' }))
        .catch(() => this.setState({ reported: 'failed' }));
    } catch {
      // reporting is best-effort; never let it mask the original fault
      this.setState({ reported: 'failed' });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center bg-frame px-6">
        <div className="max-w-[460px] text-center">
          <h1 className="text-[20px] font-semibold tracking-[-0.5px]">This screen stopped working</h1>
          <p className="mt-2.5 text-[13px] leading-[1.6] text-ink-2b">
            Something went wrong while drawing this page. Your saved work is unaffected — appraisals and documents are stored on the server,
            not in this window.
          </p>
          {/*
            Said only when it is true. A fault that could not be reported and one
            that was are different situations for the person reading this: only
            one of them needs them to tell somebody.
          */}
          <p className="mt-2 text-[12px] leading-[1.6] text-ink-3">
            {this.state.reported === 'sent'
              ? 'The fault has been reported to your workspace’s error log.'
              : this.state.reported === 'pending'
                ? 'Reporting the fault…'
                : 'This fault could not be reported automatically — please tell us what you were doing when it happened.'}
          </p>
          <div className="mt-5 flex gap-2.5 justify-center">
            {/*
              The shared primary chrome, not a local one. A hand-rolled button
              here used the brand green as a background, which is theme-aware and
              lightens in dark mode — white text on it is 3.3:1, below AA. The
              button people see least is the worst place to re-solve that.
            */}
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Back to the hub
            </Button>
          </div>
          {/* the actual message, because "an error occurred" helps nobody report it */}
          <pre className="mt-5 text-left text-[11px] leading-[1.5] text-ink-3 whitespace-pre-wrap break-words">
            {this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}
