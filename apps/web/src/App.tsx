import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { clearSession, getPrincipal, getToken, makeTrpcClient, trpc } from './lib/trpc';
import { ToastProvider, toastGlobal } from './components/Toast';

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
import Login from './routes/Login';
import Hub from './routes/Hub';
import Board from './routes/Board';
import DevelopmentAppraisal from './routes/DevelopmentAppraisal';
import AutoAppraisal from './routes/AutoAppraisal';
import Comparables from './routes/Comparables';
import Scenarios from './routes/Scenarios';
import CostMonitoring from './routes/CostMonitoring';
import SalesCrm from './routes/SalesCrm';
import DataRoom from './routes/DataRoom';
import Benchmarking from './routes/Benchmarking';
import Integrations from './routes/Integrations';
import InvestorPortal from './routes/InvestorPortal';
import BuyerPortal from './routes/BuyerPortal';
import FieldApp from './routes/FieldApp';
import Workbench from './routes/Workbench';
import AppraisalReport from './routes/AppraisalReport';
import RedBookReport from './routes/RedBookReport';
import Landing from './routes/Landing';
import DealOverview from './routes/DealOverview';
import Calendar from './routes/Calendar';
import Settings from './routes/Settings';
import Register from './routes/Register';
import SitePack from './routes/SitePack';

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
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
