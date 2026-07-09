import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getPrincipal, getToken, makeTrpcClient, trpc } from './lib/trpc';
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
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }));
  const trpcClient = useMemo(() => makeTrpcClient(), []);
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Protected><Hub /></Protected>} />
          <Route path="/board" element={<Protected><Board /></Protected>} />
          <Route path="/deal/:dealId/appraisal" element={<Protected><DevelopmentAppraisal /></Protected>} />
          <Route path="/deal/:dealId/auto" element={<Protected><AutoAppraisal /></Protected>} />
          <Route path="/deal/:dealId/comparables" element={<Protected><Comparables /></Protected>} />
          <Route path="/deal/:dealId/scenarios" element={<Protected><Scenarios /></Protected>} />
          <Route path="/deal/:dealId/costs" element={<Protected><CostMonitoring /></Protected>} />
          <Route path="/deal/:dealId/sales" element={<Protected><SalesCrm /></Protected>} />
          <Route path="/deal/:dealId/dataroom" element={<Protected><DataRoom /></Protected>} />
          <Route path="/benchmarking" element={<Protected><Benchmarking /></Protected>} />
          <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
          <Route path="/portal/investor" element={<Protected portal="investor"><InvestorPortal /></Protected>} />
          <Route path="/portal/buyer" element={<Protected portal="buyer"><BuyerPortal /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
