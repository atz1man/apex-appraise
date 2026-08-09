import './env.js';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { registerAdmin } from './admin.js';
import { createContext } from './context.js';
import { appRouter } from './router.js';
import { registerUploads } from './uploads.js';
import { registerReports } from './reports.js';
import { registerWebhooks } from './webhooks.js';
import { registerSecurity } from './security.js';
import type { TRPCError } from '@trpc/server';
import type { FastifyError } from 'fastify';
import { captureError, httpCapturePayload, trpcCapturePayload } from './errors.js';
import { prisma, type Context } from './context.js';

const PORT = Number(process.env.PORT ?? 4100);

async function main() {
  const app = Fastify({
    logger: { level: 'warn' },
    // the real client IP arrives in a header from our own proxy; without this
    // Fastify reports the proxy's address and every rate limit shares one bucket
    trustProxy: true,
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
  registerWebhooks(app);
  registerAdmin(app);
  app.get('/health', async () => ({ ok: true, service: 'apex-api' }));
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`apex-api listening on :${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
