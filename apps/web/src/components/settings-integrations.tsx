import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from './Toast';
import { Button, Panel, PlanLocked, StatusChip } from './ui';
import { featureName, featurePlanName, usePlanFeatures } from '../lib/plan';

/**
 * The three surfaces that make Apex something other systems talk to: API keys,
 * Xero and single sign-on.
 *
 * A shared idea runs through all of them. Each has a SERVER-side prerequisite the
 * customer cannot satisfy — credentials this deployment may not hold — and each
 * says so plainly rather than offering a button that cannot work. "Not configured
 * on this server" and "not connected by this firm" are different sentences, and
 * telling an admin to reconnect when the fault is ours wastes their afternoon.
 */

const shortDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

/* ------------------------------- API keys ------------------------------- */

export function ApiKeysPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: keys } = trpc.org.apiKeys.useQuery(undefined, { enabled: isAdmin });
  const [name, setName] = useState('');
  /** Shown once. The server hashes it and cannot produce it again. */
  const [minted, setMinted] = useState<{ name: string; key: string } | null>(null);

  const create = trpc.org.createApiKey.useMutation({
    onSuccess: (k) => {
      setMinted({ name: k.name, key: k.key });
      setName('');
      void utils.org.apiKeys.invalidate();
    },
  });
  const revoke = trpc.org.revokeApiKey.useMutation({
    onSuccess: () => {
      toast.push('info', 'Key revoked — anything using it will stop immediately.');
      void utils.org.apiKeys.invalidate();
    },
  });

  /**
   * The public API is an Enterprise feature, so MINTING is what the plan gates —
   * the list and the Revoke buttons below stay live on every plan. A workspace
   * that downgrades still has keys out in the world, and a paywall between an
   * admin and the revoke button turns a billing change into a security incident.
   */
  const { has } = usePlanFeatures();
  const canMint = has('publicApi');

  if (!isAdmin) return null;

  return (
    <Panel title="API keys" right={<StatusChip status={keys?.some((k) => k.live) ? 'green' : 'neutral'} label={`${keys?.filter((k) => k.live).length ?? 0} live`} />}>
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        For your own systems to read this workspace. A key belongs to the firm rather than to a person, so an integration
        keeps working after whoever set it up has moved on. See{' '}
        <code className="fig text-[11.5px]">/api/v1</code> for what it can read.
      </div>

      {minted && (
        <div className="mt-3 rounded-[10px] border p-3" style={{ borderColor: 'rgb(var(--brand-ink))' }} data-new-key>
          <div className="text-[12px] font-semibold">Copy this now — it is not shown again</div>
          <div className="mt-1 text-[11.5px] text-ink-2">
            Only the hash is stored, so nobody, including us, can produce it a second time.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input className="flex-1 fig text-[11.5px]" readOnly value={minted.key} onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(minted.key)}>
              Copy
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {!canMint && (
        <div className="mt-3">
          <PlanLocked feature={featureName('publicApi')} plan={featurePlanName('publicApi')}>
            New keys and webhook endpoints are created from {featurePlanName('publicApi')} upwards. Keys already issued
            are listed below and can still be revoked — they resume working the moment the plan includes the API again.
          </PlanLocked>
        </div>
      )}

      {canMint && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Name</span>
            <input
              className="min-w-[220px]"
              placeholder="e.g. Finance system"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Key name"
            />
          </label>
          {/*
            There was an "Allow writes" checkbox here. Every route under /api/v1 is
            a GET that asks for the read scope, and none asks for write — so
            ticking it granted a permission nothing consumes, and a firm that
            ticked it went away believing they had a key that could change their
            data. The scope machinery is kept: when a write endpoint exists, offer
            it again. apps/api/test/api-scopes.test.ts fails if the two drift.
          */}
          <Button
            size="sm"
            className="mb-1"
            disabled={!name.trim()}
            loading={create.isPending}
            onClick={() => create.mutate({ name: name.trim(), write: false })}
          >
            Create key
          </Button>
        </div>
      )}

      {!!keys?.length && (
        <div className="mt-3 flex flex-col gap-1.5">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 text-[12px] border-t border-border-faint pt-1.5">
              <span className="font-semibold min-w-0 truncate">{k.name}</span>
              <span className="fig text-[11px] text-ink-3">{k.prefix}…</span>
              <span className="fig text-[10.5px] text-ink-3">{k.scopes.join(' + ')}</span>
              <span className="flex-1" />
              <span className="fig text-[10.5px] text-ink-3">
                {k.lastUsedAt ? `used ${shortDate(k.lastUsedAt)}` : 'never used'}
              </span>
              {k.live ? (
                <Button size="sm" variant="secondary" loading={revoke.isPending && revoke.variables?.id === k.id} onClick={() => revoke.mutate({ id: k.id })}>
                  Revoke
                </Button>
              ) : (
                <StatusChip status="neutral" label="REVOKED" />
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------- Xero --------------------------------- */

export function XeroPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const { data: status } = trpc.xero.status.useQuery(undefined, { enabled: isAdmin });
  const { data: cats } = trpc.xero.categories.useQuery(undefined, { enabled: isAdmin && !!status?.connected });
  const { data: deals } = trpc.deals.list.useQuery({}, { enabled: isAdmin && !!status?.connected });

  const connect = trpc.xero.connect.useMutation({ onSuccess: (r) => { window.location.href = r.url; } });
  const complete = trpc.xero.complete.useMutation({
    onSuccess: (r) => {
      toast.success(`Connected to ${r.tenantName}`);
      void utils.xero.status.invalidate();
    },
  });
  const setCategory = trpc.xero.setCategory.useMutation({ onSuccess: () => void utils.xero.status.invalidate() });
  const mapDeal = trpc.xero.mapDeal.useMutation({ onSuccess: () => void utils.xero.status.invalidate() });
  const disconnect = trpc.xero.disconnect.useMutation({
    onSuccess: () => {
      toast.push('info', 'Xero disconnected. Cost packages already pulled are kept.');
      void utils.xero.status.invalidate();
    },
  });
  const [result, setResult] = useState<null | {
    packages: number;
    deals: number;
    committed: number;
    untrackedTotal: number;
    unmapped: Array<{ trackingOptionName: string; committed: number }>;
  }>(null);
  const sync = trpc.xero.sync.useMutation({ onSuccess: (r) => { setResult(r); void utils.xero.status.invalidate(); } });

  // returning from Xero's consent screen
  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !params.get('xero')) return;
    complete.mutate({ code, state });
    ['code', 'state', 'xero'].forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  }, [params, setParams, complete]);

  if (!isAdmin) return null;

  return (
    <Panel
      title="Xero"
      right={
        status?.connected ? (
          <StatusChip status="green" label="CONNECTED" />
        ) : (
          <StatusChip status={status?.configured ? 'neutral' : 'amber'} label={status?.configured ? 'NOT CONNECTED' : 'SETUP NEEDED'} />
        )
      }
    >
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        Pulls supplier bills into cost monitoring, so drawdown, covenants and the funding pack rest on your ledger rather
        than on figures somebody typed. Read-only — Apex never writes to your accounts.
      </div>

      {!status?.configured && (
        // the server's fault, not the firm's, and said as much
        <div className="mt-3 rounded-[10px] bg-sunken-2 px-3 py-2.5 text-[11.5px] text-ink-2 leading-snug">
          Xero is not configured on this server. Register an app at developer.xero.com and set{' '}
          <code className="fig">XERO_CLIENT_ID</code> and <code className="fig">XERO_CLIENT_SECRET</code>, with the redirect
          URI <code className="fig">{window.location.origin}/settings?xero=1</code>.
        </div>
      )}

      {status?.configured && !status.connected && (
        <div className="mt-3">
          <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
            Connect Xero
          </Button>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
            <span className="font-semibold">{status.tenantName}</span>
            <span className="text-ink-3">·</span>
            <span className="text-ink-2">{status.mappedDeals} deal{status.mappedDeals === 1 ? '' : 's'} mapped</span>
            <span className="text-ink-3">·</span>
            <span className="text-ink-2">last sync {shortDate(status.lastSyncAt)}</span>
            <span className="flex-1" />
            <Button size="sm" loading={sync.isPending} disabled={!status.trackingCategoryName} onClick={() => sync.mutate()}>
              Sync now
            </Button>
            <Button size="sm" variant="secondary" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>

          {status.lastSyncError && (
            <div className="mt-2 text-[11.5px]" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
              Last sync failed: {status.lastSyncError}
            </div>
          )}

          <div className="mt-4 border-t border-border-std pt-3">
            <div className="text-[12px] font-semibold">Which tracking category names your schemes?</div>
            <div className="mt-1 text-[11.5px] text-ink-2">
              Bills are attributed to a deal through this. Without it there is nothing to sync on.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(cats?.categories ?? []).map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={status.trackingCategoryName === c.name ? 'primary' : 'secondary'}
                  onClick={() => setCategory.mutate({ id: c.id, name: c.name })}
                >
                  {c.name}
                </Button>
              ))}
              {!cats?.categories.length && <span className="text-[11.5px] text-ink-3">No active tracking categories in Xero.</span>}
            </div>
          </div>

          {status.trackingCategoryName && (
            <div className="mt-4 border-t border-border-std pt-3">
              <div className="text-[12px] font-semibold">Map each {status.trackingCategoryName} to a deal</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {(cats?.categories.find((c) => c.name === status.trackingCategoryName)?.options ?? []).map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-[160px] truncate">{o.name}</span>
                    <select
                      className="flex-1"
                      aria-label={`Deal for ${o.name}`}
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value && mapDeal.mutate({ dealId: e.target.value, trackingOptionId: o.id, trackingOptionName: o.name })
                      }
                    >
                      <option value="">Not mapped</option>
                      {(deals?.deals ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-[10px] bg-sunken-2 px-3 py-2.5 text-[11.5px] leading-snug" data-sync-result>
              Pulled £{result.committed.toLocaleString('en-GB')} into {result.packages} package
              {result.packages === 1 ? '' : 's'} across {result.deals} deal{result.deals === 1 ? '' : 's'}.
              {/* what it could NOT place, stated rather than swallowed */}
              {result.untrackedTotal > 0 && (
                <> £{result.untrackedTotal.toLocaleString('en-GB')} of billed spend carries no {status.trackingCategoryName} and was not attributed.</>
              )}
              {result.unmapped.length > 0 && (
                <> {result.unmapped.length} tracking option{result.unmapped.length === 1 ? '' : 's'} with spend {result.unmapped.length === 1 ? 'is' : 'are'} not mapped to a deal yet.</>
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------- SSO ---------------------------------- */

export function SsoPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: sso, isLoading } = trpc.org.ssoConfig.useQuery(undefined, { enabled: isAdmin });
  const [form, setForm] = useState({ issuer: '', clientId: '', clientSecret: '', domains: '', enforced: false, defaultRole: 'ANALYST' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!sso || loaded) return;
    setForm({
      issuer: sso.issuer,
      clientId: sso.clientId,
      // never prefilled — it is not returned, and a masked value in a password
      // field invites someone to "save" it back as literal asterisks
      clientSecret: '',
      domains: sso.domains.join(', '),
      enforced: sso.enforced,
      defaultRole: sso.defaultRole,
    });
    setLoaded(true);
  }, [sso, loaded]);

  const save = trpc.org.saveSso.useMutation({
    onSuccess: () => {
      toast.success('Single sign-on saved.');
      setForm((f) => ({ ...f, clientSecret: '' }));
      void utils.org.ssoConfig.invalidate();
    },
  });
  const remove = trpc.org.deleteSso.useMutation({
    onSuccess: () => {
      toast.push('info', 'Single sign-on removed. Password sign-in is available again.');
      setLoaded(false);
      void utils.org.ssoConfig.invalidate();
    },
  });

  if (!isAdmin || isLoading) return null;

  const domains = form.domains.split(',').map((d) => d.trim()).filter(Boolean);

  return (
    <Panel
      title="Single sign-on"
      right={sso ? <StatusChip status={sso.enforced ? 'green' : 'amber'} label={sso.enforced ? 'REQUIRED' : 'OPTIONAL'} /> : undefined}
    >
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        Sign in with Microsoft Entra or Google Workspace. Anyone on a domain you claim gets an account on first sign-in,
        so there is nothing to invite. Set the redirect URI in your provider to{' '}
        <code className="fig text-[11.5px]">{window.location.origin}/sso/callback</code>.
      </div>

      <div className="mt-3 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <label className="flex flex-col gap-1">
          <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Issuer</span>
          <input
            value={form.issuer}
            placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
            onChange={(e) => setForm({ ...form, issuer: e.target.value })}
            aria-label="Issuer"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Client ID</span>
          <input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} aria-label="Client ID" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fig text-[10px] uppercase tracking-wide text-ink-3">
            Client secret {sso?.hasSecret && <span className="text-ink-3">· stored</span>}
          </span>
          <input
            type="password"
            value={form.clientSecret}
            placeholder={sso?.hasSecret ? 'Leave blank to keep the stored one' : ''}
            onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
            aria-label="Client secret"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Email domains</span>
          <input
            value={form.domains}
            placeholder="yourfirm.co.uk, yourfirm.com"
            onChange={(e) => setForm({ ...form, domains: e.target.value })}
            aria-label="Email domains"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Role on first sign-in</span>
          <select value={form.defaultRole} onChange={(e) => setForm({ ...form, defaultRole: e.target.value })} aria-label="Role on first sign-in">
            {['ANALYST', 'SURVEYOR', 'VIEWER', 'ADMIN'].map((r) => (
              <option key={r} value={r}>
                {r.charAt(0) + r.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex items-start gap-2 text-[12px]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.enforced}
          onChange={(e) => setForm({ ...form, enforced: e.target.checked })}
        />
        <span>
          <b className="font-semibold">Require single sign-on.</b>{' '}
          <span className="text-ink-2">
            Password sign-in is refused for everyone here, including accounts that already have one. Make sure you can sign
            in this way before turning it on.
          </span>
        </span>
      </label>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          loading={save.isPending}
          disabled={!form.issuer.trim() || !form.clientId.trim() || !domains.length || (!sso?.hasSecret && !form.clientSecret)}
          onClick={() =>
            save.mutate({
              issuer: form.issuer.trim(),
              clientId: form.clientId.trim(),
              clientSecret: form.clientSecret.trim() || undefined,
              domains,
              enforced: form.enforced,
              defaultRole: form.defaultRole as 'ADMIN' | 'ANALYST' | 'SURVEYOR' | 'VIEWER',
            })
          }
        >
          Save
        </Button>
        {sso && (
          <Button size="sm" variant="secondary" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
        {sso?.lastLoginAt && <span className="text-[11px] text-ink-3">last sign-in {shortDate(sso.lastLoginAt)}</span>}
      </div>
    </Panel>
  );
}

/* ----------------------------- Open banking ----------------------------- */

export function BankPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const { data: status } = trpc.bank.status.useQuery(undefined, { enabled: isAdmin });
  const { data: deals } = trpc.deals.list.useQuery({}, { enabled: isAdmin && !!status?.connected });
  const { data: pending } = trpc.bank.unclassified.useQuery(undefined, { enabled: isAdmin && !!status?.connected });

  const connect = trpc.bank.connect.useMutation({ onSuccess: (r) => { window.location.href = r.url; } });
  const complete = trpc.bank.complete.useMutation({
    onSuccess: (r) => {
      toast.success(`Connected ${r.accounts} account${r.accounts === 1 ? '' : 's'}`);
      void utils.bank.status.invalidate();
    },
  });
  const mapAccount = trpc.bank.mapAccount.useMutation({ onSuccess: () => void utils.bank.status.invalidate() });
  const classify = trpc.bank.classify.useMutation({
    onSuccess: () => {
      void utils.bank.unclassified.invalidate();
      void utils.bank.status.invalidate();
    },
  });
  const disconnect = trpc.bank.disconnect.useMutation({
    onSuccess: () => {
      toast.push('info', 'Bank feed disconnected. Transactions already imported are kept.');
      void utils.bank.status.invalidate();
    },
  });
  const [synced, setSynced] = useState<null | { imported: number; skipped: number; unclassifiedIn: number }>(null);
  const sync = trpc.bank.sync.useMutation({
    onSuccess: (r) => {
      setSynced(r);
      void utils.bank.status.invalidate();
      void utils.bank.unclassified.invalidate();
    },
  });

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !params.get('bank')) return;
    complete.mutate({ code, state });
    ['code', 'state', 'bank'].forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  }, [params, setParams, complete]);

  if (!isAdmin) return null;

  /** Under PSD2 a consent dies at 90 days; warn while there is still time. */
  const consentSoon = (status?.consentDaysLeft ?? 99) <= 14;

  return (
    <Panel
      title="Bank feed"
      right={
        status?.connected ? (
          <StatusChip status={consentSoon ? 'amber' : 'green'} label={consentSoon ? `${status.consentDaysLeft}D LEFT` : 'CONNECTED'} />
        ) : (
          <StatusChip status={status?.configured ? 'neutral' : 'amber'} label={status?.configured ? 'NOT CONNECTED' : 'SETUP NEEDED'} />
        )
      }
    >
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        Reads the statement of your development account, so the funding pack can show what actually left the account and
        what the lender actually advanced — rather than inferring both from supplier invoices. Read-only: Apex cannot move
        money.
      </div>

      {!status?.configured && (
        <div className="mt-3 rounded-[10px] bg-sunken-2 px-3 py-2.5 text-[11.5px] text-ink-2 leading-snug">
          Open banking is not configured on this server. Register with a provider (TrueLayer) and set{' '}
          <code className="fig">TRUELAYER_CLIENT_ID</code> and <code className="fig">TRUELAYER_CLIENT_SECRET</code>, with the
          redirect URI <code className="fig">{window.location.origin}/settings?bank=1</code>.
        </div>
      )}

      {status?.configured && !status.connected && (
        <div className="mt-3">
          <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
            Connect a bank account
          </Button>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
            <span className="font-semibold">{status.institution}</span>
            <span className="text-ink-3">·</span>
            <span className="text-ink-2">last sync {shortDate(status.lastSyncAt)}</span>
            <span className="flex-1" />
            <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
              Sync now
            </Button>
            <Button size="sm" variant="secondary" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>

          {consentSoon && (
            // said BEFORE the feed goes quiet, not after a lender asks why the
            // pack is stale
            <div className="mt-2 text-[11.5px]" style={{ color: 'rgb(var(--status-amber, 154 98 18))' }} data-consent-warning>
              Your bank consent expires in {status.consentDaysLeft} day{status.consentDaysLeft === 1 ? '' : 's'} — banks are
              required to ask again every {90} days. Reconnect to keep the feed running.
            </div>
          )}
          {status.lastSyncError && (
            <div className="mt-2 text-[11.5px]" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
              Last sync failed: {status.lastSyncError}
            </div>
          )}

          <div className="mt-4 border-t border-border-std pt-3">
            <div className="text-[12px] font-semibold">Which scheme does each account fund?</div>
            <div className="mt-2 flex flex-col gap-1.5">
              {status.accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-[180px] truncate">
                    {a.name} <span className="fig text-ink-3">····{a.last4}</span>
                  </span>
                  <select
                    className="flex-1"
                    aria-label={`Deal for ${a.name}`}
                    value={a.dealId ?? ''}
                    onChange={(e) => mapAccount.mutate({ accountId: a.id, dealId: e.target.value || null })}
                  >
                    <option value="">Not mapped</option>
                    {(deals?.deals ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {!!pending?.length && (
            <div className="mt-4 border-t border-border-std pt-3" data-unclassified>
              <div className="text-[12px] font-semibold">Money in — what is it?</div>
              <div className="mt-1 text-[11.5px] text-ink-2">
                A credit could be the facility, an equity injection or a sale receipt. Apex does not guess: only what you
                classify as a drawdown counts as drawn in the funding pack.
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {pending.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-[12px]">
                    <span className="fig text-[10.5px] text-ink-3 min-w-[54px]">{shortDate(t.bookedAt)}</span>
                    <span className="flex-1 min-w-0 truncate">{t.description}</span>
                    <span className="fig font-semibold">£{t.amount.toLocaleString('en-GB')}</span>
                    {(['drawdown', 'equity', 'receipt'] as const).map((c) => (
                      <Button
                        key={c}
                        size="sm"
                        variant="secondary"
                        loading={classify.isPending && classify.variables?.id === t.id}
                        onClick={() => classify.mutate({ id: t.id, classification: c })}
                      >
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {synced && (
            <div className="mt-3 rounded-[10px] bg-sunken-2 px-3 py-2.5 text-[11.5px] leading-snug" data-bank-sync-result>
              Imported {synced.imported} new transaction{synced.imported === 1 ? '' : 's'}
              {synced.skipped > 0 && <>; {synced.skipped} already held, so nothing was counted twice</>}.
              {synced.unclassifiedIn > 0 && <> {synced.unclassifiedIn} credit{synced.unclassifiedIn === 1 ? '' : 's'} still need classifying.</>}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
