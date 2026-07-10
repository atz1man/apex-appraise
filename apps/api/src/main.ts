import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import { createContext } from './context.js';
import { appRouter } from './router.js';
import { registerUploads } from './uploads.js';
import { registerReports } from './reports.js';
import { registerWebhooks } from './webhooks.js';

const PORT = Number(process.env.PORT ?? 4100);

async function main() {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, { origin: true });
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext },
  });
  await registerUploads(app);
  registerReports(app);
  registerWebhooks(app);
  app.get('/health', async () => ({ ok: true, service: 'apex-api' }));
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`apex-api listening on :${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
