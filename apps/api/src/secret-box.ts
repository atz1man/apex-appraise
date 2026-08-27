import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets at rest.
 *
 * Four things were stored in the database in plain text: Xero access and
 * refresh tokens, open-banking access and refresh tokens, the API keys a
 * workspace pastes in for the EPC register and Companies House, and the shared
 * secret each webhook endpoint signs with.
 *
 * The refresh tokens are the ones that matter. A Xero refresh token is a
 * standing key to the customer's entire accounting ledger and a TrueLayer one
 * reads their bank feed, both until somebody revokes them, and neither is
 * scoped to anything we control. Anyone holding a copy of the database held
 * both — and infra/backup.sh exists precisely to make copies of the database
 * and put them somewhere else. A backup file is not a smaller problem than a
 * breached server; it is the same problem with a longer tail.
 *
 * AES-256-GCM, because the values have to come back out — these are
 * credentials we present to somebody else, not passwords we compare, so
 * hashing is not available and authenticated encryption is the whole
 * requirement.
 *
 * The context string is authenticated data, not decoration. Without it a
 * ciphertext is portable: anyone able to WRITE the database (a compromised
 * migration, a restore of the wrong dump, an insider) could copy one firm's
 * sealed Xero token into another firm's row and the server would open it
 * happily and start reading the wrong company's ledger. Binding the workspace
 * and the field into the seal makes that paste fail.
 */

const PREFIX = 'apxs1';

/**
 * The key.
 *
 * ENCRYPTION_KEY when it is set — 32 bytes, hex or base64. Otherwise derived
 * from JWT_SECRET, which is already required in production, so this protects an
 * existing deployment on the next deploy rather than refusing to start until
 * somebody reads a changelog. HKDF with its own salt and info, so the derived
 * key is not the signing key: a leaked JWT secret is a bad day, and it should
 * not also be the key to the customer's bank feed.
 *
 * The trade is written down in infra/DEPLOY.md: while the key is derived,
 * rotating JWT_SECRET makes every sealed field unreadable, and every
 * integration has to be reconnected. Setting ENCRYPTION_KEY separates the two.
 */
function loadKey(): Buffer {
  const explicit = process.env.ENCRYPTION_KEY;
  if (explicit) {
    const raw = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, 'hex') : Buffer.from(explicit, 'base64');
    if (raw.length !== 32) {
      throw new Error(`ENCRYPTION_KEY must be 32 bytes (64 hex characters, or base64) — got ${raw.length}`);
    }
    return raw;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET is required in production');
  }
  return Buffer.from(
    hkdfSync('sha256', secret ?? 'apex-dev-secret-change-in-prod', 'apex-field-encryption', 'v1', 32),
  );
}

/**
 * Read once. The key cannot change under a running process, and re-reading
 * process.env per call would let a test mutate it halfway through a write and
 * seal two rows under different keys.
 */
let cached: Buffer | null = null;
const key = () => (cached ??= loadKey());

/**
 * Fail at boot on a key that cannot work.
 *
 * loadKey() is lazy, so without this a malformed ENCRYPTION_KEY — the
 * REPLACE_ME nobody replaced — would start the server happily and throw the
 * first time somebody connected Xero, hours later, on a screen that has no
 * business explaining a deployment mistake. Same doctrine as JWT_SECRET: a
 * configuration error stops the process, it does not wait.
 */
export const assertKeyUsable = () => void key();

/** Tests only: forget the cached key so a different one can be exercised. */
export const __resetKeyForTests = () => {
  cached = null;
};

/** Which key opened this — so a rotation can tell "wrong key" from "corrupt". */
const keyId = () => createHash('sha256').update(key()).digest('base64url').slice(0, 8);

export const isSealed = (value: string) => value.startsWith(`${PREFIX}.`);

export class SealedFieldError extends Error {}

/**
 * `apxs1.<keyId>.<iv>.<tag>.<ciphertext>`, all base64url.
 *
 * The key id is in the clear on purpose. It identifies nothing on its own — it
 * is a truncated hash of a key nobody has — and without it a value sealed under
 * an old key is indistinguishable from a corrupted one, which is the difference
 * between "reconnect Xero" and "restore from backup".
 */
export function seal(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, keyId(), iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/**
 * Open a sealed value — or hand back a legacy plaintext one unchanged.
 *
 * The read-through is what makes this deployable without a flag day: rows
 * written before this existed keep working, and are re-sealed the next time
 * anything writes them. backfillSealedFields() closes the gap for the ones that
 * never get written again.
 *
 * A value that IS sealed and will not open throws. Returning the ciphertext, or
 * null, would send a base64 blob to Xero as a bearer token and turn a key
 * problem into an authentication mystery on somebody else's server.
 */
export function open(stored: string, context: string): string {
  if (!isSealed(stored)) return stored;
  const [, id, ivB64, tagB64, ctB64] = stored.split('.');
  if (!id || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new SealedFieldError('sealed value is malformed');
  }
  const mine = Buffer.from(keyId());
  const theirs = Buffer.from(id);
  if (mine.length !== theirs.length || !timingSafeEqual(mine, theirs)) {
    throw new SealedFieldError(
      'sealed with a different key — if ENCRYPTION_KEY or JWT_SECRET changed, the integration must be reconnected',
    );
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // GCM says only "did not authenticate": a flipped byte and a ciphertext
    // lifted from another workspace's row are the same answer here, by design
    throw new SealedFieldError('sealed value did not authenticate — it was altered, or it belongs to another record');
  }
}

/**
 * The context a field is bound to.
 *
 * Model, field and the row's owning workspace. Everything that identifies WHERE
 * a value is allowed to live, so moving it anywhere else breaks the seal.
 */
export const fieldContext = (model: string, field: string, orgId: string) => `${model}.${field}:${orgId}`;
