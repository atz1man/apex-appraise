import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Network-edge controls: who may call the API from a browser, and how often.
 */

/** Origins allowed to call this API from a browser. */
export function allowedOrigins(): string[] {
  const configured = [process.env.APP_URL, process.env.WEB_URL].filter(Boolean) as string[];
  // Local development and the docker stack: vite, the nginx image, and the API
  // itself when something calls it directly.
  const local = ['http://localhost:5273', 'http://localhost:8080', 'http://localhost:4100'];
  return [...new Set([...configured, ...(process.env.NODE_ENV === 'production' ? [] : local)])].map((o) =>
    o.replace(/\/$/, ''),
  );
}

/**
 * The caller's real IP.
 *
 * This is the whole game for rate limiting here. Browser traffic reaches this API
 * through the web app's nginx, so `request.ip` is the WEB MACHINE's address —
 * identical for every customer. Limiting on that would put the entire user base
 * in one bucket: one busy firm locks out everybody, and an attacker is
 * indistinguishable from normal load. Fly stamps `Fly-Client-IP` at its edge and
 * nginx now forwards it; `x-forwarded-for`'s first entry is the fallback.
 *
 * Both headers are only trustworthy because nothing but our own proxy can reach
 * this app — the API is flycast-only (no public http_service).
 */
export function clientIp(req: FastifyRequest): string {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.length) return fly;
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return first || req.ip;
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Procedures where a wrong guess is worth something to an attacker: password
 * guessing, reset-token guessing, and using the reset endpoint to mail-bomb a
 * user. Matched by substring so tRPC's batched paths ("/trpc/auth.login,org.get")
 * cannot slip past a prefix check.
 */
const SENSITIVE = ['auth.login', 'auth.requestPasswordReset', 'auth.resetPassword'];

export const isSensitive = (url: string) => SENSITIVE.some((p) => url.includes(p));

export async function registerSecurity(app: FastifyInstance) {
  const origins = allowedOrigins();
  await app.register(cors, {
    // An allowlist, not `origin: true`. Reflecting any origin lets any website a
    // logged-in valuer visits read this API with their browser.
    origin: (origin, cb) => {
      // No Origin header: same-origin navigations, server-to-server, and the PDF
      // renderer. CORS is not what protects those — the JWT is.
      if (!origin) return cb(null, true);
      cb(null, origins.includes(origin.replace(/\/$/, '')));
    },
  });

  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    // Two buckets per IP. Sensitive procedures get their own, much smaller budget,
    // so hammering the login endpoint cannot hide inside ordinary app traffic.
    keyGenerator: (req) => `${isSensitive(req.url) ? 'auth' : 'all'}:${clientIp(req)}`,
    max: (req: FastifyRequest) =>
      isSensitive(req.url) ? num('AUTH_RATE_LIMIT_PER_MIN', 10) : num('RATE_LIMIT_PER_MIN', 600),
    // statusCode must be in the body the builder returns: without it the plugin
    // hands Fastify a plain object, which becomes a 500 — the request is still
    // blocked, but it looks like a server fault rather than a deliberate refusal.
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      // nothing about counts or reset times: a prober should not be able to read
      // how close they are to the limit
      message: 'Too many requests — try again shortly',
    }),
  });
}
