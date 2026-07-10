import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { clearSession, getPrincipal, getToken, makeTrpcClient, trpc } from './lib/trpc';
import { ToastProvider, toastGlobal } from './components/Toast';
import { BrandMark } from './components/ui';

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
const FieldApp = lazy(() => import('./routes/FieldApp'));
const Workbench = lazy(() => import('./routes/Workbench'));
const AppraisalReport = lazy(() => import('./routes/AppraisalReport'));
const RedBookReport = lazy(() => import('./routes/RedBookReport'));
const Landing = lazy(() => import('./routes/Landing'));
const DealOverview = lazy(() => import('./routes/DealOverview'));
const Calendar = lazy(() => import('./routes/Calendar'));
const Settings = lazy(() => import('./routes/Settings'));
const Register = lazy(() => import('./routes/Register'));
const SitePack = lazy(() => import('./routes/SitePack'));

/** Branded splash while a route chunk loads — calm, no layout jank. */
function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 animate-pulseDot">
        <BrandMark size={40} />
        <span className="text-[13px] font-semibold text-ink-3">
          Apex <span className="text-brand-500">Appraise</span>
        </span>
      </div>
    </div>
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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
        queryCache: new QueryCache({
          onError: (err) => void handleAuthError(err),
        }),
        // every failed mutation surfaces as a toast — no more silent failures
        mutationCache: new MutationCache({
          onError: (err) => {
            if (handleAuthError(err)) return;
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
        <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/welcome" element={<Landing />} />
          <Route path="/" element={<Protected><Hub /></Protected>} />
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
          <Route path="/benchmarking" element={<Protected><Benchmarking /></Protected>} />
          <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
          <Route path="/portal/investor" element={<Protected portal="investor"><InvestorPortal /></Protected>} />
          <Route path="/portal/buyer" element={<Protected portal="buyer"><BuyerPortal /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
