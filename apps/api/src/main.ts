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
    trpcOptions: { router: appRouter, createContext },
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
