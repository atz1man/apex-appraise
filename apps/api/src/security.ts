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
 *
 * `org.register` belongs here for the third of those reasons and was missing.
 * It is public, it sends a welcome email to an address the caller supplies, and
 * the subject and body carry the caller's own `name` and `orgName` — so at the
 * general budget it is a relay for a hundred and sixty characters of somebody
 * else's text, from this firm's domain, sixty times a minute. It is also the
 * only public procedure that creates permanent rows: an Organisation, a User
 * and a connector row per workspace, none of which any sweeper removes.
 *
 * The throttle inside the procedure does not cover this. It is keyed
 * `register:<email>` and only `recordFailure`s when the address is already
 * taken, so it limits probing ONE address and not registering a thousand new
 * ones — which is the case that costs something.
 */
const SENSITIVE = ['auth.login', 'auth.requestPasswordReset', 'auth.resetPassword', 'org.register'];

export const isSensitive = (url: string) => SENSITIVE.some((p) => url.includes(p));

/**
 * The operation names in a tRPC request, batched or not.
 *
 * A batch is one HTTP request whose path is every procedure name joined by
 * commas — see the maxParamLength note in main.ts, which raised the cap to 5000
 * characters so a busy page could ask for everything at once.
 */
export function operationsIn(url: string): string[] {
  const path = url.split('?')[0] ?? '';
  const after = path.indexOf('/trpc/');
  if (after < 0) return [];
  /**
   * Decoded BEFORE the split, not after. `%2C` is a comma, so
   * `auth.login%2Cauth.login` is two operations wearing one name — splitting
   * first and decoding the pieces sees a single procedure called
   * "auth.login,auth.login" and waves the batch through.
   */
  let raw = path.slice(after + '/trpc/'.length);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // a malformed escape is not a path we can reason about; treat it as one
    // opaque operation rather than guessing at what it meant
  }
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * A batch may not carry a sensitive procedure alongside anything else.
 *
 * The limiter above counts REQUESTS. Batching puts many operations in one
 * request, so the ten-per-minute budget on `auth.login` was ten BATCHES per
 * minute, and each batch could hold as many logins as the path had room for.
 * Measured against a real instance: one request carrying sixty logins was
 * accepted whole and counted once, and the same address then sent a further two
 * hundred and forty inside the same minute. At the 5000-character path limit a
 * single request holds about four hundred and fifty of them — a control written
 * to allow ten attempts a minute allowing roughly four and a half thousand.
 *
 * The per-email lockout in `auth/password.ts` is not the answer to this and was
 * never meant to be: it stops five guesses against ONE account. The attack this
 * opens is the other shape — one password against thousands of DIFFERENT
 * accounts, where no address is tried twice and no lock ever trips. The
 * volumetric bucket is the only thing standing in front of that, which is
 * exactly why it must not be multipliable.
 *
 * Refusing beats charging the batch its true cost. A login arrives as a single
 * user action and the browser's batch link sends it alone; sixty of them in one
 * request is not traffic any client of ours produces, so there is nothing to
 * meter — it is malformed intent, and saying so is simpler to state, simpler to
 * test, and cannot be tuned wrong.
 */
export const batchesSensitive = (url: string): boolean => {
  const ops = operationsIn(url);
  return ops.length > 1 && ops.some((op) => SENSITIVE.some((s) => op.includes(s)));
};

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

  /**
   * A volumetric backstop, per instance, and deliberately not the auth control.
   *
   * The thing an attacker actually wants to defeat — five password guesses, three
   * reset mails — is the AuthThrottle table, which is shared across instances and
   * cannot be multiplied by asking a different machine. This limiter exists to
   * blunt crude floods, and per-instance is an acceptable weakening of that:
   * N instances means N times the flood budget, which is still a bound, and the
   * alternative is a database round trip on every single request including the
   * ones a flood consists of.
   *
   * If shared volumetric limiting is wanted, nginx already sits in front of every
   * instance and does it without a new service — see infra/DEPLOY.md.
   */
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    // Two buckets per IP. Sensitive procedures get their own, much smaller budget,
    // so hammering the login endpoint cannot hide inside ordinary app traffic.
    /**
     * An API key gets its own bucket, not its customer's IP.
     *
     * Integrations call from a handful of server addresses, and several customers
     * behind one cloud provider's egress would otherwise share a limit and
     * throttle each other. The key is also the thing we can talk to them about.
     */
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer apex_live_')) {
        return `key:${auth.slice(7, 40)}`;
      }
      return `${isSensitive(req.url) ? 'auth' : 'all'}:${clientIp(req)}`;
    },
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

  /**
   * `preParsing`, and the choice of phase is the whole point.
   *
   * A refused batch must cost the sender their budget. If it is free they can
   * send them without limit and map the rule out for nothing, which turns a
   * control into a target. That means this check has to run AFTER the limiter
   * has counted the request.
   *
   * Registration order does not achieve it. `register` is deferred and
   * `addHook` is immediate, so an `onRequest` added on the line below
   * `await app.register(rateLimit, …)` still runs first — and so does one added
   * through `after()`. Measured, with both: the eleventh refused batch from a
   * single address still came back 400 rather than 429.
   *
   * The lifecycle settles it where ordering could not. The limiter answers at
   * `onRequest` and short-circuits, so nothing at a later phase runs on a
   * request it refused — measured directly: a limited request logs the
   * onRequest hooks and never reaches preParsing. Sitting here therefore
   * guarantees the count has happened, and does it without depending on which
   * plugin was registered first. It also refuses before the body is read, so a
   * large batch payload is never parsed.
   */
  app.addHook('preParsing', async (req, reply, payload) => {
    if (!batchesSensitive(req.url)) return payload;
    await reply.code(400).send({
      statusCode: 400,
      error: 'Bad Request',
      // no counts, no thresholds — the same reasoning as the 429 above
      message: 'Sign-in and account procedures must be sent one per request.',
    });
    return payload;
  });
}
