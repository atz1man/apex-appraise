/**
 * The read-only client for a workspace's own data, over the public API.
 *
 * Two things it deliberately does NOT do.
 *
 * It does not talk to the database, and it does not import the API's routers.
 * `/api/v1` is a versioned promise about shape that already exists, is already
 * authenticated by an org-scoped key, and already refuses another firm's ids
 * with the same 404 it gives for one that never existed. A second path to the
 * same rows would be a second place for that to be got wrong.
 *
 * And it does not write. Every route it calls is a GET, so nothing here can
 * change a figure, approve a version or move a deal — which is why this server
 * needs no answer to the audit-trail question that every mutation in this
 * product has to answer. If a write tool is ever added, it writes an audit
 * event or it does not ship.
 */

export interface WorkspaceConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Where the workspace is and which key opens it, or null when neither was set.
 *
 * Null rather than a throw at startup: the engine tools below need no
 * workspace at all, and a developer modelling a scheme on their own numbers
 * should not have to hold an API key to do it. The workspace tools say what is
 * missing at the moment they are called instead.
 */
export function workspaceFromEnv(env: NodeJS.ProcessEnv = process.env): WorkspaceConfig | null {
  const apiKey = env.APEX_API_KEY?.trim();
  const baseUrl = (env.APEX_API_URL?.trim() || 'http://localhost:4100').replace(/\/+$/, '');
  if (!apiKey) return null;
  return { baseUrl, apiKey };
}

export const NO_WORKSPACE =
  'This tool reads your Apex Appraise workspace and no API key is configured. Set APEX_API_KEY to a key from ' +
  'Settings → API keys, and APEX_API_URL to your instance (default http://localhost:4100). The calculation tools ' +
  'need neither and work as they are.';

export class WorkspaceError extends Error {}

/**
 * A GET against the public API, with the server's refusals turned into
 * sentences a model can act on.
 *
 * The API's own error bodies are already written for a person — "This key does
 * not carry the read scope", "…included from Growth" — so they are passed
 * through rather than replaced with a status code. What is added is the part
 * the API cannot know: which knob the caller should reach for.
 */
export async function apiGet<T>(cfg: WorkspaceConfig, path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(`${cfg.baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${cfg.apiKey}`, accept: 'application/json' } });
  } catch (e) {
    throw new WorkspaceError(
      `Could not reach Apex Appraise at ${cfg.baseUrl} (${(e as Error).message}). Check APEX_API_URL, and that the instance is running.`,
    );
  }

  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    const hint =
      res.status === 401
        ? ' Create a key in Settings → API keys and set APEX_API_KEY to it.'
        : res.status === 402
          ? ' Nothing is wrong with the key — the workspace is on a plan that does not include the public API.'
          : res.status === 403
            ? ' Mint a key carrying the read scope.'
            : '';
    throw new WorkspaceError(`${message}${hint}`);
  }
  return body as T;
}
