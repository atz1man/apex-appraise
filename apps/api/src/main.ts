import './env.js';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { registerAdmin } from './admin.js';
import { createContext } from './context.js';
import { appRouter } from './router.js';
import { registerUploads } from './uploads.js';
import { registerReports } from './reports.js';
import { registerTiles } from './tiles.js';
import { registerHealth } from './health.js';
import { startRowSweeper } from './row-sweeper.js';
import { registerWebhooks } from './webhooks.js';
import { registerPublicApi } from './public-api.js';
import { registerSecurity } from './security.js';
import type { TRPCError } from '@trpc/server';
import type { FastifyError } from 'fastify';
import { captureError, httpCapturePayload, trpcCapturePayload } from './errors.js';
import { prisma, type Context } from './context.js';
import { drainWebhooks } from './webhook-delivery.js';

const PORT = Number(process.env.PORT ?? 4100);

async function main() {
  const app = Fastify({
    logger: { level: 'warn' },
    // the real client IP arrives in a header from our own proxy; without this
    // Fastify reports the proxy's address and every rate limit shares one bucket
    trustProxy: true,
    /**
     * tRPC batches a page's queries into ONE request whose path is every
     * procedure name joined by commas. Fastify's default cap on a route parameter
     * is 100 characters, so a page asking for enough at once is refused with a
     * bare 414 — and because the batch is atomic, EVERY panel on that page loses
     * its data together rather than one of them failing visibly.
     *
     * Settings crossed it at 106 characters:
     *   org.get,billing.config,org.members,org.policy,org.ssoConfig,
     *   xero.status,bank.status,org.apiKeys,org.errors
     *
     * The limit is worth naming rather than nudging: it is length-dependent, so
     * the next procedure added to any busy screen re-breaks it silently, and the
     * failure looks like a backend outage rather than a routing limit.
     */
    maxParamLength: 5000,
  });
  await registerSecurity(app);
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      /**
       * Only INTERNAL_SERVER_ERROR is captured. A NOT_FOUND or a FORBIDDEN is the
       * API working — recording those would bury the faults under a log of the
       * system correctly saying no.
       */
      onError({ error, path, type, ctx }: { error: TRPCError; path?: string; type: string; ctx?: Context }) {
        const payload = trpcCapturePayload(error, {
          path,
          type,
          orgId: ctx?.principal?.orgId,
          userId: ctx?.principal?.userId,
        });
        if (payload) void captureError(prisma, payload);
      },
    },
  });

  /**
   * Everything that is not tRPC: uploads, report rendering, webhooks. Same rule —
   * 5xx only, because a 404 for a mistyped URL is not a fault of ours.
   */
  app.setErrorHandler((error: FastifyError, req, reply) => {
    const statusCode = error.statusCode ?? 500;
    const payload = httpCapturePayload(error, { method: req.method, url: req.url });
    if (payload) {
      void captureError(prisma, payload);
      req.log.error(error, 'request failed');
    }
    // a 5xx never explains itself to the caller: the detail is in the error table
    reply.code(statusCode).send({ error: statusCode >= 500 ? 'Internal server error' : error.message });
  });
  await registerUploads(app);
  registerReports(app);
  registerTiles(app);
  registerWebhooks(app);
  registerPublicApi(app);
  registerAdmin(app);
  registerHealth(app, prisma);
  /**
   * Webhook delivery runs on a timer in-process. No queue server: one more piece
   * of infrastructure to operate is a worse trade at this size than a table and a
   * loop, and the retry schedule lives in the delivery module either way.
   */
  /**
   * Sweep the two tables that only ever grow. On boot AND on a timer: AuthThrottle
   * is keyed by the email a stranger typed, so a boot-only sweep bounded its size
   * by how often we happened to deploy. See row-sweeper.ts.
   */
  startRowSweeper(prisma, {
    onSweep: (r) => app.log.warn(r, 'pruned expired rows'),
    onError: (e) => app.log.error(e, 'row sweep failed'),
  });

  const drain = setInterval(() => {
    void drainWebhooks(prisma).catch((e: unknown) => app.log.error(e, 'webhook drain failed'));
  }, 15_000);
  drain.unref();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`apex-api listening on :${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
