import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { clearSession, getPrincipal, trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { Avatar, Button, Panel, Skeleton, SkeletonRows, StatCard, StatusChip, TopBar } from '../components/ui';

const ROLES = ['ADMIN', 'ANALYST', 'SURVEYOR', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];

const ROLE_TONE: Record<Role, StatusKey> = {
  ADMIN: 'green',
  ANALYST: 'blue',
  SURVEYOR: 'amber',
  VIEWER: 'neutral',
};

const dateGB = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function roleTone(role: string): StatusKey {
  return ROLE_TONE[role as Role] ?? 'neutral';
}

// ---------- Organisation ----------

function OrganisationPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: org, isLoading } = trpc.org.get.useQuery();
  const [name, setName] = useState<string | null>(null);
  const update = trpc.org.update.useMutation({
    onSuccess: () => {
      utils.org.get.invalidate();
      toast.success('Workspace name updated');
    },
  });

  if (isLoading || !org) {
    return (
      <Panel title="Organisation">
        <div className="max-w-[460px]">
          <Skeleton width={110} height={10} className="mb-2" />
          <Skeleton height={38} className="mb-3" />
          <Skeleton width={200} height={10} />
        </div>
        <div className="mt-4 flex gap-3 flex-wrap">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={150} height={72} className="rounded-card" />
          ))}
        </div>
      </Panel>
    );
  }

  const draft = name ?? org.name;
  const dirty = draft.trim() !== org.name && draft.trim().length >= 2;

  return (
    <Panel title="Organisation">
      <div className="max-w-[460px]">
        <label className="label-mono text-ink-3 block mb-1">Workspace name</label>
        {isAdmin ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) update.mutate({ name: draft.trim() });
            }}
          >
            <input className="flex-1" aria-label="Workspace name" value={draft} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={update.isPending} disabled={!dirty}>
              Save
            </Button>
          </form>
        ) : (
          <div className="text-[15px] font-semibold">{org.name}</div>
        )}
        <div className="mt-2 text-[12px] text-ink-3">
          Workspace created {dateGB(org.createdAt)}
        </div>
      </div>
      <div className="mt-4 flex gap-3 flex-wrap">
        <StatCard label="Deals" value={org.counts.deals} />
        <StatCard label="Members" value={org.counts.users} />
        <StatCard label="Investors" value={org.counts.investors} />
      </div>
    </Panel>
  );
}

// ---------- Members ----------

function InviteForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: '', email: '', role: 'ANALYST' as Role });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const invite = trpc.org.invite.useMutation({
    onSuccess: (res) => {
      setTempPassword(res.tempPassword);
      utils.org.members.invalidate();
      utils.org.get.invalidate();
      toast.success(`Invited ${form.name.trim()}`);
    },
  });

  if (tempPassword) {
    return (
      <div className="mb-4 rounded-card border border-status-amber-bg bg-sunken p-4">
        <div className="label-mono text-status-amber mb-1.5">One-time temporary password</div>
        <div className="flex gap-2 items-center">
          <code className="fig flex-1 rounded-input border border-border-strong bg-sunken-2 px-3 py-2 text-[13px] select-all">
            {tempPassword}
          </code>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(tempPassword).then(
                () => toast.success('Password copied to clipboard'),
                () => toast.error('Could not copy — select and copy it manually'),
              );
            }}
          >
            Copy
          </Button>
        </div>
        <div className="mt-2 text-[12px] text-ink-2b leading-relaxed">
          Share this with {form.name.trim() || 'your teammate'} now — it won&rsquo;t be shown again. They sign in
          with it at <span className="fig">{form.email.trim().toLowerCase()}</span> and should change it straight away.
        </div>
        <div className="mt-3">
          <Button variant="ghost" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const valid = form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email.trim());

  return (
    <form
      className="mb-4 rounded-card border border-border-std bg-sunken p-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) invite.mutate({ name: form.name.trim(), email: form.email.trim(), role: form.role });
      }}
    >
      <div className="flex-1 min-w-[160px]">
        <label htmlFor="invite-name" className="label-mono text-ink-3 block mb-1">Name</label>
        <input id="invite-name" className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </div>
      <div className="flex-1 min-w-[200px]">
        <label htmlFor="invite-email" className="label-mono text-ink-3 block mb-1">Email</label>
        <input id="invite-email" className="w-full" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <label htmlFor="invite-role" className="label-mono text-ink-3 block mb-1">Role</label>
        <select id="invite-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={invite.isPending} disabled={!valid}>
          Send invite
        </Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function MembersPanel({ isAdmin, selfId }: { isAdmin: boolean; selfId: string }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.org.members.useQuery();
  const [inviting, setInviting] = useState(false);
  const setRole = trpc.org.setRole.useMutation({
    onSuccess: () => {
      utils.org.members.invalidate();
      toast.success('Role updated');
    },
  });

  return (
    <Panel
      title="Members"
      right={
        isAdmin && !inviting ? <Button variant="secondary" onClick={() => setInviting(true)}>Invite teammate</Button> : undefined
      }
    >
      {inviting && <InviteForm onDone={() => setInviting(false)} />}
      {isLoading ? (
        <SkeletonRows rows={4} height={30} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Member</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Email</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Joined</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Role</th>
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => {
                const isSelf = m.id === selfId;
                return (
                  <tr key={m.id}>
                    <td className="py-2.5 px-2 border-t border-border-faint">
                      <span className="flex items-center gap-2.5">
                        <Avatar initials={m.initials} />
                        <span className="text-[13px] font-semibold">
                          {m.name}
                          {isSelf && <span className="ml-1.5 font-normal text-[11.5px] text-ink-3">(you)</span>}
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 px-2 border-t border-border-faint text-[12.5px] text-ink-2 max-w-[240px] truncate">{m.email}</td>
                    <td className="py-2.5 px-2 border-t border-border-faint fig text-[12px] text-ink-2b">{dateGB(m.createdAt)}</td>
                    <td className="py-2.5 px-2 border-t border-border-faint">
                      {isAdmin && !isSelf ? (
                        <select
                          value={m.role}
                          aria-label={`Role for ${m.name}`}
                          disabled={setRole.isPending && setRole.variables?.userId === m.id}
                          onChange={(e) => setRole.mutate({ userId: m.id, role: e.target.value as Role })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusChip status={roleTone(m.role)} label={m.role} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- Security ----------

function SecurityPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed');
    },
  });

  return (
    <Panel title="Security">
      <form
        className="max-w-[380px]"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (next.length < 8) return setError('New password must be at least 8 characters.');
          if (next !== confirm) return setError('New passwords don’t match.');
          change.mutate({ current, next });
        }}
      >
        <label className="label-mono text-ink-3 block mb-1">Current password</label>
        <input className="w-full mb-3" type="password" aria-label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label className="label-mono text-ink-3 block mb-1">New password</label>
        <input className="w-full mb-3" type="password" aria-label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label className="label-mono text-ink-3 block mb-1">Confirm new password</label>
        <input className="w-full mb-3" type="password" aria-label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="text-[12px] text-status-red mb-3">{error}</div>}
        <Button type="submit" loading={change.isPending} disabled={!current || !next || !confirm}>
          Change password
        </Button>
      </form>
      <div className="mt-4 pt-4 border-t border-border-faint text-[12px] text-ink-2b leading-relaxed max-w-[460px]">
        Sessions last 12 hours. When a session expires you&rsquo;re signed out on all devices — changing your
        password here takes effect from your next sign-in.
      </div>
    </Panel>
  );
}

// ---------- Data & privacy (GDPR) ----------

function DataPrivacyPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [showAudit, setShowAudit] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [armed, setArmed] = useState(false);
  const { data: org } = trpc.org.get.useQuery();
  const auditQ = trpc.org.auditLog.useQuery({ limit: 200 }, { enabled: showAudit, staleTime: 30_000 });
  const destroy = trpc.org.deleteWorkspace.useMutation({
    onSuccess: () => {
      clearSession();
      navigate('/welcome');
    },
    onError: (e) => toast.error(e.message),
  });

  const exportAll = async () => {
    setExporting(true);
    try {
      const data = await utils.client.org.exportData.query();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `apex-appraise-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('Workspace export downloaded');
    } catch {
      toast.error('Export failed — try again');
    }
    setExporting(false);
  };

  const fmtAt = (d: Date | string) =>
    new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <Panel title="Data & privacy">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-[460px]">
            <div className="text-[13.5px] font-semibold">Export workspace data</div>
            <div className="mt-1 text-[12px] text-ink-2b leading-relaxed">
              One JSON file with every deal, appraisal, comparable, document record, investor position and audit
              event this workspace owns — GDPR-portable, no passwords or card data.
            </div>
          </div>
          <Button variant="secondary" loading={exporting} onClick={exportAll}>
            Download export
          </Button>
        </div>

        <div className="pt-4 border-t border-border-faint">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-[460px]">
              <div className="text-[13.5px] font-semibold">Audit trail</div>
              <div className="mt-1 text-[12px] text-ink-2b leading-relaxed">
                Who did what, across every deal — saves, versions, extractions, exports, sign-offs.
              </div>
            </div>
            <Button variant="secondary" onClick={() => setShowAudit((v) => !v)}>
              {showAudit ? 'Hide audit trail' : 'View audit trail'}
            </Button>
          </div>
          {showAudit && (
            <div className="mt-3 rounded-card border border-border-std bg-sunken max-h-[320px] overflow-y-auto">
              {auditQ.isLoading ? (
                <div className="p-4"><SkeletonRows rows={5} height={22} /></div>
              ) : (auditQ.data ?? []).length === 0 ? (
                <div className="p-4 text-[12.5px] text-ink-2">No activity recorded yet.</div>
              ) : (
                <table className="w-full border-collapse">
                  <tbody>
                    {(auditQ.data ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 px-3 border-b border-border-faint fig text-[11px] text-ink-3 whitespace-nowrap align-top">{fmtAt(e.at)}</td>
                        <td className="py-2 px-3 border-b border-border-faint text-[12px] align-top">
                          <span className="font-semibold">{e.actor}</span>{' '}
                          <span className="text-ink-2">{e.action}</span>{' '}
                          <span className="text-ink">{e.target}</span>
                          {e.dealName && <span className="text-ink-3"> · {e.dealName}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border-faint">
          <div className="text-[13.5px] font-semibold text-status-red">Danger zone</div>
          <div className="mt-1 text-[12px] text-ink-2b leading-relaxed max-w-[460px]">
            Permanently delete this workspace — every deal, appraisal, document record, member and investor
            position. This cannot be undone. Download an export first.
          </div>
          {!armed ? (
            <Button variant="danger" className="mt-3" onClick={() => setArmed(true)}>
              Delete workspace…
            </Button>
          ) : (
            <form
              className="mt-3 flex items-end gap-2 flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (confirmName.trim() === org?.name) destroy.mutate({ confirmName: confirmName.trim() });
              }}
            >
              <div>
                <label htmlFor="confirm-delete" className="label-mono text-ink-3 block mb-1">
                  Type <span className="fig font-semibold">{org?.name}</span> to confirm
                </label>
                <input
                  id="confirm-delete"
                  className="w-[260px]"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  autoFocus
                />
              </div>
              <Button type="submit" variant="danger" loading={destroy.isPending} disabled={confirmName.trim() !== org?.name}>
                Permanently delete
              </Button>
              <Button variant="ghost" onClick={() => { setArmed(false); setConfirmName(''); }}>
                Cancel
              </Button>
            </form>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---------- About ----------

function AboutPanel() {
  const navigate = useNavigate();
  return (
    <Panel title="About">
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <div className="flex items-center gap-2">
          <span className="label-mono text-ink-3 w-[72px]">Version</span>
          <span className="fig">0.1.0</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="label-mono text-ink-3 w-[72px]">Source</span>
          <a
            href="https://github.com/atz1man/apex-appraise"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-500 hover:text-brand-700"
          >
            github.com/atz1man/apex-appraise →
          </a>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border-faint">
        <Button
          variant="danger"
          onClick={() => {
            clearSession();
            navigate('/login');
          }}
        >
          Sign out
        </Button>
        <div className="mt-2 text-[11.5px] text-ink-3">Ends this session on this device only.</div>
      </div>
    </Panel>
  );
}

// ---------- Page ----------

function BillingPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = trpc.billing.config.useQuery();
  const sync = trpc.billing.sync.useMutation({
    onSuccess: (res) => {
      utils.billing.config.invalidate();
      if (res.plan !== 'TRIAL') toast.success(`Subscription active — ${res.plan} plan`);
    },
  });
  const checkout = trpc.billing.checkout.useMutation({
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  // returning from Stripe Checkout — reconcile the subscription state
  useEffect(() => {
    const flag = params.get('billing');
    if (!flag) return;
    if (flag === 'success') sync.mutate();
    if (flag === 'cancelled') toast.error('Checkout cancelled — no changes made');
    params.delete('billing');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <Panel title="Billing & plan">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={200} className="rounded-card" />
          ))}
        </div>
      </Panel>
    );
  }
  if (!data) return null;
  return (
    <Panel
      title="Billing & plan"
      right={
        <span className="flex items-center gap-2">
          {data.mode === 'test' && data.configured && <StatusChip status="amber" label="STRIPE TEST MODE" />}
          <StatusChip status={data.plan === 'TRIAL' ? 'neutral' : 'green'} label={data.plan} />
        </span>
      }
    >
      {!data.configured ? (
        <div className="text-[12.5px] text-ink-2">
          Stripe isn't configured on this server — set <code className="fig">STRIPE_SECRET_KEY</code> to enable subscriptions.
        </div>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {data.plans.map((p) => {
              const current = data.plan === p.key;
              return (
                <div
                  key={p.key}
                  className="rounded-card border p-4 flex flex-col"
                  style={{ borderColor: current ? '#14503B' : 'rgb(var(--border-strong, 230 229 222))', background: current ? 'rgb(var(--sunken, 251 252 251))' : '#fff' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold">{p.name}</span>
                    {current && <StatusChip status="green" label="CURRENT" />}
                  </div>
                  <div className="fig mt-1.5 text-[20px] font-semibold tracking-[-0.5px]">
                    £{(p.pricePencePerMonth / 100).toLocaleString('en-GB')}<span className="text-[11px] text-ink-3 font-medium">/mo</span>
                  </div>
                  <div className="mt-1 text-[11.5px] text-ink-2">{p.blurb}</div>
                  <ul className="mt-2.5 flex flex-col gap-1 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="text-[11.5px] text-ink-2 flex gap-1.5">
                        <span className="text-brand-500">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  {isAdmin && !current && (
                    <Button
                      className="mt-3 w-full"
                      variant={p.key === 'GROWTH' ? 'primary' : 'secondary'}
                      loading={checkout.isPending && checkout.variables?.plan === p.key}
                      disabled={checkout.isPending}
                      onClick={() => checkout.mutate({ plan: p.key })}
                    >
                      {data.plan === 'TRIAL' ? 'Subscribe' : 'Switch plan'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10.5px] text-ink-3">
            Card payments are processed by Stripe Checkout — no card details touch this server.
            {data.mode === 'test' && ' Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.'}
          </div>
        </>
      )}
    </Panel>
  );
}

export default function Settings() {
  const principal = getPrincipal();
  const isAdmin = principal?.role === 'ADMIN';

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Workspace settings"
        right={principal && <StatusChip status={roleTone(principal.role)} label={principal.role} />}
      />
      <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
        <OrganisationPanel isAdmin={isAdmin} />
        <BillingPanel isAdmin={isAdmin} />
        <MembersPanel isAdmin={isAdmin} selfId={principal?.userId ?? ''} />
        <SecurityPanel />
        {isAdmin && <DataPrivacyPanel />}
        <AboutPanel />
      </main>
    </div>
  );
}
