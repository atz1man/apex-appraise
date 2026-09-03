import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    /** Declared by a mutation whose screen shows its own error — see the cache handler below. */
    mutationMeta: { inlineError?: boolean };
  }
}
import { Suspense, lazy, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
        {/* every screen, because the field app is the one that needs it — see OfflineBanner */}
        <OfflineBanner />
        {/* a render fault must not leave a blank page — see ErrorBoundary */}
        <ErrorBoundary>
        <Suspense fallback={<Splash />}>
        <div key={location.pathname} className="page-enter">
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
        </div>
        </Suspense>
        </ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
