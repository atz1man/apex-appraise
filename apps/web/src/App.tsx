import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    /** Declared by a mutation whose screen shows its own error — see the cache handler below. */
    mutationMeta: { inlineError?: boolean };
  }
}
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { frameHeadingFor, titleFor } from './lib/page-title';
import { shouldInterceptNavigation, unsavedMessage, unsavedWork } from './lib/unsaved';
import { clearSession, getPrincipal, getToken, makeTrpcClient, trpc } from './lib/trpc';
import { ToastProvider, toastGlobal } from './components/Toast';
import { OfflineBanner } from './components/OfflineBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BrandMark } from './components/ui';

/** message → last time it was shown, so a failed batch does not stack toasts */
const recentQueryErrors = new Map<string, number>();

/** Expired/invalid session anywhere → clean sign-out and back to login. */
function handleAuthError(err: unknown): boolean {
  const code = (err as { data?: { code?: string } })?.data?.code;
  if (code === 'UNAUTHORIZED' && getToken()) {
    clearSession();
    toastGlobal('info', 'Your session expired — please sign in again.');
    window.location.href = '/login';
    return true;
  }
  return false;
}

// Route-level code splitting: each screen ships as its own chunk — critical on
// mobile connections. Heavy libs (exceljs, leaflet) are already lazy inside.
const Login = lazy(() => import('./routes/Login'));
const Hub = lazy(() => import('./routes/Hub'));
const FundingPack = lazy(() => import('./routes/FundingPack'));
const Board = lazy(() => import('./routes/Board'));
const DevelopmentAppraisal = lazy(() => import('./routes/DevelopmentAppraisal'));
const AutoAppraisal = lazy(() => import('./routes/AutoAppraisal'));
const Comparables = lazy(() => import('./routes/Comparables'));
const Scenarios = lazy(() => import('./routes/Scenarios'));
const CostMonitoring = lazy(() => import('./routes/CostMonitoring'));
const SalesCrm = lazy(() => import('./routes/SalesCrm'));
const DataRoom = lazy(() => import('./routes/DataRoom'));
const Benchmarking = lazy(() => import('./routes/Benchmarking'));
const Integrations = lazy(() => import('./routes/Integrations'));
const InvestorPortal = lazy(() => import('./routes/InvestorPortal'));
const BuyerPortal = lazy(() => import('./routes/BuyerPortal'));
const NotFound = lazy(() => import('./routes/NotFound'));
const FieldApp = lazy(() => import('./routes/FieldApp'));
const Workbench = lazy(() => import('./routes/Workbench'));
const AppraisalReport = lazy(() => import('./routes/AppraisalReport'));
const RedBookReport = lazy(() => import('./routes/RedBookReport'));
const Engagement = lazy(() => import('./routes/Engagement'));
const EngagementDocument = lazy(() => import('./routes/EngagementDocument'));
const SignTerms = lazy(() => import('./routes/SignTerms'));
const Landing = lazy(() => import('./routes/Landing'));
const DealOverview = lazy(() => import('./routes/DealOverview'));
const Calendar = lazy(() => import('./routes/Calendar'));
const Settings = lazy(() => import('./routes/Settings'));
const Investors = lazy(() => import('./routes/Investors'));
const Register = lazy(() => import('./routes/Register'));
const ForgotPassword = lazy(() => import('./routes/ForgotPassword'));
const ResetPassword = lazy(() => import('./routes/ResetPassword'));
const SsoCallback = lazy(() => import('./routes/SsoCallback'));
const ApiDocs = lazy(() => import('./routes/ApiDocs'));
const SitePack = lazy(() => import('./routes/SitePack'));
const WhatsNew = lazy(() => import('./routes/WhatsNew'));
// public, and deliberately not behind Protected: a privacy notice you have to
// sign in to read is not a privacy notice
const Privacy = lazy(() => import('./routes/Legal').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./routes/Legal').then((m) => ({ default: m.Terms })));

/** Branded splash while a route chunk loads — calm, no layout jank. */
function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 animate-pulseDot">
        <BrandMark size={40} />
        <span className="text-[13px] font-semibold text-ink-3">
          Apex <span className="text-brand-ink">Appraise</span>
        </span>
      </div>
    </div>
  );
}

/** Signed in → the workspace. Signed out → the pitch. */
function Root() {
  return getToken() && getPrincipal() ? (
    <Protected>
      <Hub />
    </Protected>
  ) : (
    <Landing />
  );
}

function Protected({ children, portal }: { children: JSX.Element; portal?: 'buyer' | 'investor' }) {
  const location = useLocation();
  const token = getToken();
  const principal = getPrincipal();
  if (!token || !principal) return <Navigate to="/login" state={{ from: location }} replace />;
  // route each principal type to its own surface
  if (portal && principal.principalType !== portal && principal.principalType !== 'internal') return <Navigate to="/login" replace />;
  if (!portal && principal.principalType === 'buyer') return <Navigate to="/portal/buyer" replace />;
  if (!portal && principal.principalType === 'investor') return <Navigate to="/portal/investor" replace />;
  return children;
}

/**
 * The wrapper every route renders inside, and the two things a browser does on
 * a real navigation that a single-page app does not.
 *
 * THE SCROLL. React Router does not reset it and nothing else did either, so
 * leaving the foot of a long appraisal for Settings landed you several hundred
 * pixels down Settings, past its heading, with nothing to say you had arrived.
 *
 * THE FOCUS. Keyboard focus stayed on the link that had just been replaced —
 * in practice `<body>`, so the next Tab restarted at the top of the document —
 * and a screen reader announced nothing, because for it nothing had happened.
 *
 * Both live HERE rather than in an effect on `location.pathname` in `App`, and
 * that is not a tidying-up. `App`'s effect fires when the URL changes; this
 * component mounts when the new page's DOM EXISTS, and those are not the same
 * moment. Every route is `lazy()`, so on a first visit React suspends, the
 * fallback replaces this subtree, and at the instant the URL-keyed effect ran
 * there was no wrapper to focus — measured on CI as `document.activeElement`
 * being `<body>` after a click that had, to the eye, worked perfectly. Keyed on
 * the pathname, this remounts per navigation, and a mount effect cannot run
 * before the thing it focuses is there.
 *
 * `first` is skipped deliberately: `/login` and `/register` autofocus a field
 * and stealing that would be a regression dressed as a fix. It is a ref owned
 * by `App`, because this component is remounted by its key and cannot remember
 * anything itself — which is the same property that makes it work.
 */
/**
 * Keyed on the pathname, so it mounts once per navigation and its mount effect
 * is what moves the person to the new screen.
 *
 * It remembers the path it last moved focus FOR, rather than counting mounts.
 * Counting was the first attempt and it was wrong in a way only development
 * showed: the guard was a boolean consumed on mount, and `React.StrictMode`
 * deliberately invokes a mount effect twice. The first run spent the guard and
 * returned; the second saw it spent and focused. So on a FRESH DOCUMENT in dev,
 * focus landed on `#page` — which sits after the skip link — and the skip link
 * became unreachable by the first Tab. WCAG 2.4.1, failing in development only,
 * which is the half a developer testing with a keyboard actually uses.
 *
 * Production was unaffected (StrictMode double-invokes in dev alone) and that is
 * the trap: `e2e/navigation.spec.ts` runs against the built app and passed
 * throughout. A guard that only holds in one build mode is not a guard, and the
 * double invocation is React telling you so — an effect has to survive being
 * mounted, torn down and mounted again.
 *
 * Remembering the path survives it: the second invocation sees the path it just
 * handled and does nothing, while a real navigation always brings a new one.
 * The first page of a document is still left alone deliberately — the browser
 * has already put focus at the top, which is where the skip link is.
 *
 * NOT PROVEN BY CI, and worth knowing before trusting a green build here. Both
 * halves were mutation-tested and both are killed by the skip-link spec — but
 * only when that spec runs against the DEV server, because StrictMode's double
 * invocation is a development behaviour and CI drives the built app behind
 * nginx. Removing the remount guard is therefore invisible to CI and visible
 * the moment somebody runs the suite locally against `pnpm dev`. Removing the
 * first-page guard breaks both builds and CI does catch that one.
 */
function PageFrame({ focusedFor, path, children }: { focusedFor: { current: string | null }; path: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // the document's own first page: leave the browser's focus where it is
    if (focusedFor.current === null) {
      focusedFor.current = path;
      return;
    }
    // already moved for this navigation — a remount, not a new screen
    if (focusedFor.current === path) return;
    focusedFor.current = path;
    window.scrollTo(0, 0);
    ref.current?.focus({ preventScroll: true });
  }, [focusedFor, path]);
  // the screens whose visible title is the breadcrumb get their outline root
  // here, hidden — see FRAME_HEADING for the measurement that put them there
  const heading = frameHeadingFor(path);
  return (
    // tabIndex -1: focusable by script and by the skip link, never by Tab
    <div id="page" ref={ref} tabIndex={-1} className="page-enter outline-none">
      {heading && <h1 className="sr-only">{heading}</h1>}
      {children}
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
        queryCache: new QueryCache({
          /**
           * A failed QUERY used to be silent. Mutations already toast — the
           * asymmetry meant a page whose data would not load rendered as though
           * there were simply nothing to show, which is a different statement
           * and a false one. That is exactly how a 414 on Settings went
           * unnoticed: nine panels lost their data at once and the page looked
           * merely empty.
           *
           * react-query retries once before this fires, so anything reaching
           * here has already failed twice.
           */
          onError: (err) => {
            if (handleAuthError(err)) return;
            /**
             * A deliberate refusal is the API working, not a fault. A revoked
             * signing link answers NOT_FOUND and its page already explains that
             * in its own words — a toast on top says the same thing twice, in
             * vaguer language, and trains people to ignore the toast that
             * matters. This mirrors the server's rule for what it records: only
             * the unexpected.
             */
            const code = (err as { data?: { code?: string } })?.data?.code;
            const HANDLED = [
              'NOT_FOUND',
              'FORBIDDEN',
              'BAD_REQUEST',
              'CONFLICT',
              'TOO_MANY_REQUESTS',
              'UNPROCESSABLE_CONTENT',
              // signed out on a public page: handleAuthError only acts when
              // there IS a session to expire, so anything reaching here is the
              // API correctly refusing an anonymous read, not a fault
              'UNAUTHORIZED',
            ];
            if (code && HANDLED.includes(code)) return;
            const message = err instanceof Error ? err.message : 'Something went wrong';
            /**
             * Deduped within a short window: one batched request carrying nine
             * queries fails as nine errors, and nine identical toasts would be
             * worse than none.
             */
            const now = Date.now();
            const last = recentQueryErrors.get(message) ?? 0;
            if (now - last < 8_000) return;
            recentQueryErrors.set(message, now);
            toastGlobal('error', `Couldn't load this page's data — ${message}`);
          },
        }),
        /**
         * Every failed mutation surfaces — once.
         *
         * This handler is the single owner of the error toast, which is what it
         * was written to be: "no more silent failures". What it did not account
         * for is that a screen may already be showing the failure where it
         * happened, and react-query runs BOTH this and the mutation's own
         * onError. Measured in a browser: one refused invite produced two
         * identical toasts, and a form rendering its error inline showed the
         * same sentence twice in two places.
         *
         * So a mutation whose screen displays its own error says so with
         * `meta: { inlineError: true }` and this stays quiet. A toast is for a
         * failure with nowhere else to appear.
         */
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            if (handleAuthError(err)) return;
            if (mutation.meta?.inlineError) return;
            toastGlobal('error', err instanceof Error ? err.message : 'Something went wrong');
          },
        }),
      }),
  );
  const trpcClient = useMemo(() => makeTrpcClient(), []);

  /**
   * The TITLE. 37 routes shared one, set in `index.html` and never touched
   * again — see `lib/page-title.ts` for what that cost.
   *
   * This one belongs here rather than in `PageFrame` because it is the only
   * one of the three that does not need the new page's DOM to exist: it is a
   * fact about the URL. The scroll and the focus do need it, and that
   * distinction is the whole reason they are no longer in this effect.
   */
  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    document.title = titleFor(location.pathname);
  }, [location.pathname]);

  /**
   * Leaving a screen that holds unsaved work, by clicking a link.
   *
   * `beforeunload` covers closing the tab and reloading. It does NOT fire when
   * a link changes the route, because nothing is unloading — and that is the
   * exit a person actually takes. React Router's `useBlocker` would be the
   * proper answer and needs a data router; this app mounts `<BrowserRouter>`,
   * so the interception happens where every link click passes: the document,
   * in the CAPTURE phase, which runs before React Router's own handler and is
   * the only place a click can still be stopped.
   *
   * `shouldInterceptNavigation` holds the decision and is tested at its
   * boundaries. Everything it refuses is a click that does not take the person
   * off this screen — a middle click, a ⌘-click, an external URL, a download,
   * the skip link, a link to the page they are already on. A prompt for any of
   * those is a prompt for nothing, which is how people learn to dismiss
   * prompts without reading them.
   *
   * On "yes" this navigates itself rather than replaying the click, because
   * the click has already been cancelled by then. The dirty screen unmounts on
   * the way out and its own effect clears the registry.
   */
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const what = unsavedWork();
      if (!what) return;
      const anchor = (e.target as Element | null)?.closest?.('a');
      const decision = shouldInterceptNavigation({
        dirty: true,
        button: e.button,
        modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        defaultPrevented: e.defaultPrevented,
        href: anchor?.getAttribute('href') ?? null,
        target: anchor?.getAttribute('target') ?? null,
        download: anchor?.hasAttribute('download') ?? false,
        currentPath: window.location.pathname,
      });
      if (!decision) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.confirm(unsavedMessage(what))) navigate(anchor!.getAttribute('href')!);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
        {/* every screen, because the field app is the one that needs it — see OfflineBanner */}
        <OfflineBanner />
        {/*
          WCAG 2.4.1 (Bypass Blocks). Every internal screen opens with a sticky
          header carrying the brand lockup, a breadcrumb and up to six global
          links, so a keyboard user reached the actual content of a deal on the
          ninth Tab, on every screen, every time. Visually hidden until focused,
          which is the first thing Tab reaches from the top of the document.
        */}
        <a
          href="#page"
          className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:top-3 focus:left-3 focus:px-4 focus:py-2 focus:rounded-[10px] focus:bg-surface focus:text-ink focus:shadow-float focus:outline focus:outline-2 focus:outline-brand-ink"
          onClick={(e) => {
            // an href alone moves the browser's :target, not focus — and this is
            // exactly the control whose entire purpose is to move focus
            e.preventDefault();
            document.getElementById('page')?.focus();
            window.scrollTo(0, 0);
          }}
        >
          Skip to main content
        </a>
        {/* a render fault must not leave a blank page — see ErrorBoundary */}
        <ErrorBoundary>
        <Suspense fallback={<Splash />}>
        <PageFrame key={location.pathname} path={location.pathname} focusedFor={focusedFor}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/reset" element={<ResetPassword />} />
          {/* the redirect URI auth.ssoStart hands the identity provider */}
          <Route path="/sso/callback" element={<SsoCallback />} />
          <Route path="/welcome" element={<Landing />} />
          <Route path="/whats-new" element={<WhatsNew />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* static "/terms" is the terms of service; "/terms/:token" below is a
              client signing a specific engagement — React Router ranks the static
              path first, so the two do not collide */}
          <Route path="/terms" element={<Terms />} />
          {/* the address /api/v1 hands every integrator */}
          <Route path="/docs/api" element={<ApiDocs />} />
          {/* The root is the front door for BOTH audiences. A signed-in user gets
              their workspace; a stranger gets the product and its pricing, rather
              than being bounced to a login form with demo credentials on it —
              which is what happened, and it made the marketing page unreachable
              unless you already knew the /welcome URL. */}
          <Route path="/" element={<Root />} />
          <Route path="/portfolio/pack" element={<Protected><FundingPack /></Protected>} />
          <Route path="/board" element={<Protected><Board /></Protected>} />
          <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="/deal/:dealId" element={<Protected><DealOverview /></Protected>} />
          <Route path="/deal/:dealId/sitepack" element={<Protected><SitePack /></Protected>} />
          <Route path="/deal/:dealId/appraisal" element={<Protected><DevelopmentAppraisal /></Protected>} />
          <Route path="/deal/:dealId/auto" element={<Protected><AutoAppraisal /></Protected>} />
          <Route path="/deal/:dealId/comparables" element={<Protected><Comparables /></Protected>} />
          <Route path="/deal/:dealId/scenarios" element={<Protected><Scenarios /></Protected>} />
          <Route path="/deal/:dealId/costs" element={<Protected><CostMonitoring /></Protected>} />
          <Route path="/deal/:dealId/sales" element={<Protected><SalesCrm /></Protected>} />
          <Route path="/deal/:dealId/dataroom" element={<Protected><DataRoom /></Protected>} />
          <Route path="/field" element={<Protected><FieldApp /></Protected>} />
          <Route path="/deal/:dealId/workbench" element={<Protected><Workbench /></Protected>} />
          <Route path="/deal/:dealId/report" element={<Protected><AppraisalReport /></Protected>} />
          <Route path="/deal/:dealId/redbook" element={<Protected><RedBookReport /></Protected>} />
          <Route path="/terms/:token" element={<SignTerms />} />
          <Route path="/deal/:dealId/engagement" element={<Protected><Engagement /></Protected>} />
          <Route path="/deal/:dealId/engagement/document" element={<Protected><EngagementDocument /></Protected>} />
          <Route path="/benchmarking" element={<Protected><Benchmarking /></Protected>} />
          <Route path="/investors" element={<Protected><Investors /></Protected>} />
          <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
          <Route path="/portal/investor" element={<Protected portal="investor"><InvestorPortal /></Protected>} />
          <Route path="/portal/buyer" element={<Protected portal="buyer"><BuyerPortal /></Protected>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </PageFrame>
        </Suspense>
        </ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
