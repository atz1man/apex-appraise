import { router } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { dealsRouter } from './routers/deals.js';
import { appraisalRouter, autoAppraisalRouter, comparablesRouter, scenariosRouter } from './routers/appraisal.js';
import { salesRouter } from './routers/sales.js';
import { costRouter, documentsRouter, integrationsRouter, photosRouter, tasksRouter } from './routers/ops.js';
import { orgRouter } from './routers/org.js';
import { buyerRouter, investorsRouter } from './routers/portal.js';
import { inspectionsRouter } from './routers/inspections.js';
import { sitePackRouter } from './routers/sitepack.js';
import { billingRouter } from './routers/billing.js';
import { benchmarksRouter } from './routers/benchmarks.js';

export const appRouter = router({
  auth: authRouter,
  org: orgRouter,
  deals: dealsRouter,
  appraisal: appraisalRouter,
  autoAppraisal: autoAppraisalRouter,
  comparables: comparablesRouter,
  scenarios: scenariosRouter,
  sales: salesRouter,
  inspections: inspectionsRouter,
  sitePack: sitePackRouter,
  billing: billingRouter,
  cost: costRouter,
  photos: photosRouter,
  tasks: tasksRouter,
  documents: documentsRouter,
  benchmarks: benchmarksRouter,
  investors: investorsRouter,
  buyer: buyerRouter,
  integrations: integrationsRouter,
});

export type AppRouter = typeof appRouter;
