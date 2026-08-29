import { Component, type ErrorInfo, type ReactNode } from 'react';
import { color, radius } from '../../tokens';
import { rescueBackup } from '../../lib/storage';

/**
 * What is on screen when the app cannot render.
 *
 * Without this, a throw anywhere below it unmounts the whole tree: measured,
 * and it is a blank page with no text and not one button, while the receipts
 * sit intact in localStorage with no server holding a copy. A reload recovers
 * only when the fault is on a screen you had to navigate to — a fault on the
 * first screen, or one caused by a particular stored receipt, lands straight
 * back in the blank state on every launch. The app has already had exactly
 * that shape of bug once, and it was fixed at the data layer; this is the
 * same fix at the render layer, for causes nobody has thought of yet.
 *
 * The rescue deliberately does NOT go through the app's own state, its
 * loader, or its receipt reader. Any of those may be what just threw. It
 * reads the store, copies it, and offers it as a file.
 *
 * A class component because that is the only thing React lets catch a render
 * error, and it is why this one file is not a hook.
 */
interface State {
  failed: boolean;
  saved: 'idle' | 'done' | 'nothing';
}

export class Recovery extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, saved: 'idle' };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nowhere to send it — no server, and the privacy notice says nothing
    // leaves the device — so the console is the whole of the reporting. It is
    // still worth writing: it is what a person can copy into a bug report.
    console.error('kept could not render:', error, info.componentStack);
  }

  private rescue = () => {
    const backup = rescueBackup();
    if (!backup) {
      this.setState({ saved: 'nothing' });
      return;
    }
    const url = URL.createObjectURL(new Blob([backup.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kept-rescue-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setState({ saved: 'done' });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: 14, padding: '28px 22px', background: color.cream, color: color.ink,
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
        }}
      >
        <h1 tabIndex={-1} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: 0 }}>
          Something in kept broke
        </h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: color.body, margin: 0 }}>
          Your receipts are still on this device and nothing has been deleted. Save a copy before anything else — kept
          keeps them here and nowhere else, so a file on your phone is the only backup there is.
        </p>
        <button
          type="button"
          onClick={this.rescue}
          style={{
            padding: '14px 18px', borderRadius: radius.pill, border: `1.5px solid ${color.ink}`,
            background: color.yellow, color: color.ink, fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
          }}
        >
          Save my receipts to a file
        </button>
        {this.state.saved === 'done' && (
          <p role="status" style={{ fontSize: 13.5, color: color.body, margin: 0 }}>
            Saved. You can bring it back with <strong>Restore from a backup</strong> in Settings.
          </p>
        )}
        {this.state.saved === 'nothing' && (
          <p role="status" style={{ fontSize: 13.5, color: color.body, margin: 0 }}>
            There was nothing stored on this device to save.
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '13px 18px', borderRadius: radius.pill, border: `1.5px solid ${color.ink}`,
            background: color.white, color: color.ink, fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </main>
    );
  }
}
