import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { App } from './App';
import { color } from '../tokens';

/**
 * On a phone the app is the whole viewport. On a desktop it renders in a
 * 402px column on the cream ground — the width the design was drawn at, and
 * the width the landing page embeds. No drawn bezel: the handoff is explicit
 * that the iPhone frame is presentation for the prototype, not part of the
 * product, and a fake device chrome around a real installed app is a lie
 * about what you are using.
 */
function Shell() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: `radial-gradient(900px 700px at 50% -10%, ${color.creamWarm}, #EDE8D8 70%)`,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 402,
          height: '100dvh',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(23,20,16,0.08)',
        }}
      >
        <App />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);

// The service worker is what makes the deadline checkable with no signal —
// the one piece of infrastructure a local-first app genuinely needs.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/app/' }).catch(() => {
      // Offline caching is an enhancement; a registration failure (private
      // mode, unsupported context) must not take the app down with it.
    });
  });
}
