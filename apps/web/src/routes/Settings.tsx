import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { clearSession, getPrincipal, setSession, trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { ApiKeysPanel, BankPanel, SsoPanel, WebhooksPanel, XeroPanel } from '../components/settings-integrations';
import { Avatar, Button, FirmMark, Panel, PlanLocked, Skeleton, SkeletonRows, StatCard, StatusChip, TopBar } from '../components/ui';
import { featureName, featurePlanName, usePlanFeatures } from '../lib/plan';

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
  const [rics, setRics] = useState<string | null>(null);
  const update = trpc.org.update.useMutation({
    onSuccess: (_d, vars) => {
      utils.org.get.invalidate();
      setRics(null);
      toast.success(
        vars.ricsFirmNumber === undefined
          ? 'Workspace name updated'
          : vars.ricsFirmNumber
            ? 'RICS regulation recorded — the mark now appears on your documents'
            : 'RICS regulation withdrawn — the mark no longer appears on your documents',
      );
    },
  });
  const [uploading, setUploading] = useState(false);
  const clearLogo = trpc.org.clearLogo.useMutation({
    onSuccess: () => {
      utils.org.get.invalidate();
      toast.success('Firm logo removed — documents fall back to the Apex mark');
    },
  });

  /** Documents carry the firm's mark; the app chrome stays Apex. */
  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/uploads/logo', {
        method: 'POST',
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token') ?? ''}` },
        body,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Upload failed');
      }
      await utils.org.get.invalidate();
      toast.success('Firm logo updated — it appears on reports and terms');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

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
  const ricsDraft = rics ?? org.ricsFirmNumber;
  const ricsDirty = ricsDraft.trim() !== org.ricsFirmNumber;

  /**
   * "RICS Regulated" used to be printed on the Red Book cover, its signature
   * seal and the terms of engagement for every firm on the platform, with
   * nothing behind it. It is a claim about this firm's regulatory standing made
   * to a lender, so the firm makes it here or the documents do not make it.
   */
  const ricsBlock = (
    <div className="mt-5 border-t border-border-std pt-4">
      <div className="text-[13.5px] font-semibold">RICS Regulated Firm number</div>
      <div className="mt-1 text-[12px] text-ink-2b leading-relaxed max-w-[520px]">
        Shown on the Red Book valuation and the terms of engagement, so a reader can check the firm on the RICS register.
        Leave it empty if the firm is not RICS regulated — those documents then carry no regulatory mark.
      </div>
      <div className="mt-3 max-w-[320px]">
        {isAdmin ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ricsDirty) update.mutate({ ricsFirmNumber: ricsDraft.trim() });
            }}
          >
            <input
              className="flex-1 fig"
              aria-label="RICS Regulated Firm number"
              placeholder="e.g. 123456"
              value={ricsDraft}
              onChange={(e) => setRics(e.target.value)}
            />
            <Button type="submit" loading={update.isPending} disabled={!ricsDirty}>
              Save
            </Button>
          </form>
        ) : (
          <div className="text-[15px] font-semibold fig">{org.ricsFirmNumber || 'Not declared'}</div>
        )}
      </div>
    </div>
  );
  const logoBlock = (
    <div className="mt-5 border-t border-border-std pt-4">
      <div className="text-[13.5px] font-semibold">Firm logo</div>
      <div className="mt-1 text-[12px] text-ink-2b leading-relaxed max-w-[520px]">
        Appears on the appraisal report, the Red Book valuation and the terms of engagement — the documents your clients
        see. PNG, JPEG or WebP, up to 2MB. Without one, those documents carry the Apex mark.
      </div>
      <div className="mt-3 flex items-center gap-4 flex-wrap">
        <div
          className="flex items-center justify-center rounded-card border border-border-std bg-sunken px-4"
          style={{ height: 64, minWidth: 120 }}
        >
          <FirmMark logoUrl={org.logoUrl} size={36} alt={`${org.name} logo`} />
        </div>
        {isAdmin && (
          <>
            <label className="inline-flex">
              <input
                type="file"
                className="sr-only"
                aria-label="Upload firm logo"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
                  e.target.value = '';
                }}
              />
              <span
                className="inline-flex items-center justify-center font-semibold px-3 h-[31px] text-[12px] rounded-[10px] bg-surface text-ink-2 border border-border-strong hover:bg-sunken cursor-pointer"
                role="button"
              >
                {uploading ? 'Uploading…' : org.logoUrl ? 'Replace logo' : 'Upload logo'}
              </span>
            </label>
            {org.logoUrl && (
              <Button size="sm" variant="secondary" loading={clearLogo.isPending} onClick={() => clearLogo.mutate()}>
                Remove
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );

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
      {logoBlock}
      {ricsBlock}
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

// ---------- Demo mailbox ----------

/**
 * What would have been emailed, on an instance that cannot send.
 *
 * The API has kept this in memory for a long time and nothing displayed it, so
 * the flows it exists for — invite a colleague, forgot your password — were
 * demonstrable only by reading a server console. The reset flow in particular
 * could not be shown at all.
 *
 * The panel hides itself unless the server says the mailbox is on, which is
 * demo mode AND no SMTP. On any instance that sends real email there is nothing
 * here and nothing to hide.
 */
function DemoMailboxPanel({ isAdmin }: { isAdmin: boolean }) {
  const { data } = trpc.org.demoMailbox.useQuery(undefined, { enabled: isAdmin, refetchInterval: 15_000 });
  const [open, setOpen] = useState<string | null>(null);

  if (!isAdmin || !data?.enabled) return null;

  return (
    <Panel
      title="Demo mailbox"
      right={<StatusChip status="amber" label={`${data.messages.length} HELD`} />}
    >
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        This server has no outbound email configured and is running in demo mode, so invitations and password-reset
        links are held here instead of being sent. Only this workspace's messages appear, and nothing is kept once{' '}
        <code className="fig text-[11.5px]">SMTP_URL</code> is set.
      </div>

      {data.messages.length === 0 ? (
        <div className="mt-3 text-[12.5px] text-ink-3">Nothing yet.</div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {data.messages.map((m) => (
            <div key={`${m.at}-${m.to}`} className="border-t border-border-faint pt-2">
              <button
                type="button"
                className="w-full text-left flex items-baseline gap-3"
                onClick={() => setOpen(open === `${m.at}-${m.to}` ? null : `${m.at}-${m.to}`)}
              >
                <span className="text-[12.5px] font-semibold min-w-0 truncate">{m.subject}</span>
                <span className="text-[11.5px] text-ink-3 min-w-0 truncate">{m.to}</span>
                <span className="flex-1" />
                <span className="fig text-[10.5px] text-ink-3">
                  {new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
              {open === `${m.at}-${m.to}` && (
                <pre className="fig mt-2 overflow-x-auto whitespace-pre-wrap rounded-[8px] bg-sunken px-3 py-2 text-[11.5px] leading-[1.6] text-ink-2">
                  {m.text}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------- Portal access ----------

/**
 * Who from outside the firm can sign in, and what they see.
 *
 * The portals have worked for a long time and there was no way to let anybody
 * into one: outside the demo seed, every User row was created by registration
 * or by inviting a colleague, and both are internal. So a firm on Growth had
 * bought "Buyer + investor portals" and could not give a single buyer or
 * investor a login.
 *
 * Sits next to Members deliberately. It is the same question — who can sign in —
 * and an admin looking for it will look here rather than under integrations.
 */
function PortalAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: logins, isLoading } = trpc.portalAccess.list.useQuery();
  const { data: candidates } = trpc.portalAccess.candidates.useQuery(undefined, { enabled: isAdmin });

  const [kind, setKind] = useState<'investor' | 'buyer'>('investor');
  const [target, setTarget] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const { has } = usePlanFeatures();
  const canInvite = has('portals');

  const done = (res: { tempPassword: string; emailed: boolean }) => {
    setTempPassword(res.tempPassword);
    setEmailed(res.emailed);
    setForm({ name: '', email: '' });
    setTarget('');
    void utils.portalAccess.list.invalidate();
  };
  const inviteInvestor = trpc.portalAccess.inviteInvestor.useMutation({ onSuccess: done });
  const inviteBuyer = trpc.portalAccess.inviteBuyer.useMutation({ onSuccess: done });
  const pending = inviteInvestor.isPending || inviteBuyer.isPending;

  const revoke = trpc.portalAccess.revoke.useMutation({
    onSuccess: (_res, vars) => {
      const gone = (logins ?? []).find((l) => l.id === vars.userId);
      setRevoking(null);
      void utils.portalAccess.list.invalidate();
      toast.success(gone ? `${gone.name} can no longer sign in` : 'Portal access revoked');
    },
  });

  const options = kind === 'investor'
    ? (candidates?.investors ?? []).map((i) => ({ id: i.id, label: i.name }))
    : (candidates?.units ?? []).map((u) => ({ id: u.id, label: u.buyerName ? `${u.label} — ${u.buyerName}` : u.label }));

  return (
    <Panel
      title="Portal access"
      right={<StatusChip status={logins?.length ? 'green' : 'neutral'} label={`${logins?.length ?? 0} outside`} />}
    >
      <div className="text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        A buyer or an investor signs in and sees one thing: their own reservation, or their own position. Never the
        pipeline, never another buyer, never the firm's figures. A portal login is not a team member and does not use a
        seat on your plan.
      </div>

      {tempPassword && (
        <div className="mt-3 rounded-card border border-status-amber-bg bg-sunken p-4">
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
            <Button variant="secondary" onClick={() => setTempPassword(null)}>
              Done
            </Button>
          </div>
          <div className="mt-2 text-[11.5px] text-ink-2">
            {emailed
              ? 'Sent to them by email as well. It is not shown again.'
              : 'No email is configured on this server, so pass it on yourself. It is not shown again.'}
          </div>
        </div>
      )}

      {isAdmin && !canInvite && (
        <div className="mt-3">
          <PlanLocked feature={featureName('portals')} plan={featurePlanName('portals')}>
            New portal logins are issued from {featurePlanName('portals')} upwards. Anyone already invited is listed
            below and can still be revoked.
          </PlanLocked>
        </div>
      )}

      {isAdmin && canInvite && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const payload = { name: form.name.trim(), email: form.email.trim() };
            if (kind === 'investor') inviteInvestor.mutate({ ...payload, investorId: target });
            else inviteBuyer.mutate({ ...payload, unitId: target });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Portal</span>
            <select
              className="h-[36px]"
              aria-label="Portal"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'investor' | 'buyer');
                setTarget('');
              }}
            >
              <option value="investor">Investor</option>
              <option value="buyer">Buyer</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="fig text-[10px] uppercase tracking-wide text-ink-3">
              {kind === 'investor' ? 'Investor' : 'Reserved unit'}
            </span>
            <select
              className="h-[36px] max-w-[260px]"
              aria-label={kind === 'investor' ? 'Investor' : 'Reserved unit'}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Name</span>
            {/* "Portal user name", not "Name": the members panel above has a Name
                field too, and two inputs with one label is ambiguous to a screen
                reader before it is ambiguous to a test */}
            <input
              className="min-w-[160px]"
              aria-label="Portal user name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fig text-[10px] uppercase tracking-wide text-ink-3">Email</span>
            <input
              className="min-w-[200px]"
              aria-label="Portal user email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <Button type="submit" className="mb-1" disabled={!target || form.name.trim().length < 2 || !form.email.includes('@')} loading={pending}>
            Invite to portal
          </Button>
          {kind === 'buyer' && candidates && candidates.units.length === 0 && (
            <div className="w-full text-[11.5px] text-ink-3">
              {/* an unsold unit has no buyer to invite, so the list is empty rather than wrong */}
              No unit is reserved yet — a buyer portal is about a reservation.
            </div>
          )}
        </form>
      )}

      <div className="mt-4">
        {isLoading ? (
          <SkeletonRows rows={2} />
        ) : !logins?.length ? (
          <div className="text-[12.5px] text-ink-3">Nobody outside the firm can sign in.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {logins.map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-[12.5px] border-t border-border-faint pt-2">
                <Avatar initials={l.initials} size={26} />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{l.name}</div>
                  <div className="text-[11px] text-ink-3 truncate">{l.email}</div>
                </div>
                <StatusChip status="neutral" label={l.kind.toUpperCase()} />
                <span className="text-[11.5px] text-ink-2 min-w-0 truncate">
                  {/* the row it pointed at can be deleted from under it; saying so
                      beats printing a blank where a plot number should be */}
                  {l.sees ?? 'no longer attached to anything'}
                </span>
                <span className="flex-1" />
                {isAdmin &&
                  (revoking === l.id ? (
                    <>
                      <span className="text-[11.5px] text-ink-2">Sign-in ends immediately.</span>
                      <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate({ userId: l.id })}>
                        Revoke
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setRevoking(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setRevoking(l.id)}>
                      Revoke
                    </Button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
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
  /**
   * Removal is irreversible and it is the control an admin reaches for in a
   * hurry — someone has just left, or an account has just been compromised. So
   * it arms in place rather than opening a dialog that could be dismissed by
   * accident, and it spells out the consequences before it is armed, not after.
   */
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = trpc.org.removeMember.useMutation({
    onSuccess: (res, vars) => {
      const gone = (members ?? []).find((m) => m.id === vars.userId);
      setRemoving(null);
      utils.org.members.invalidate();
      utils.billing.config.invalidate(); // the seat count on the Billing tab moves too
      toast.success(gone ? `${gone.name} removed — their access has ended` : 'Member removed');
      /**
       * Their API keys are not revoked with them — those are workspace
       * credentials and killing one would take a live integration down. But a
       * leaver may hold a copy, so say so instead of letting the admin assume
       * the door is fully shut.
       */
      if (res.apiKeysCreated > 0) {
        toast.push(
          'info',
          `They created ${res.apiKeysCreated} API key${res.apiKeysCreated === 1 ? '' : 's'} that ${res.apiKeysCreated === 1 ? 'is' : 'are'} still live — review them under Integrations.`,
        );
      }
      /**
       * The opposite problem, and the more urgent one. A key goes on working; a
       * report link STOPS. Whoever holds it — a lender, a client's solicitor —
       * gets "ask the sender for a new one", about a sender who has just been
       * removed, and nobody here would otherwise know.
       */
      if (res.sharesCreated > 0) {
        toast.push(
          'info',
          `${res.sharesCreated} report link${res.sharesCreated === 1 ? '' : 's'} they shared ${res.sharesCreated === 1 ? 'has' : 'have'} stopped working — re-share from the deal if anyone still needs ${res.sharesCreated === 1 ? 'it' : 'them'}.`,
        );
      }
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
        <>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Member</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Email</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Joined</th>
                <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-left">Role</th>
                {isAdmin && <th className="label-mono text-ink-3 font-semibold pb-2 px-2 text-right"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => {
                const isSelf = m.id === selfId;
                return (
                  <tr key={m.id} className="hover:bg-sunken transition-colors">
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
                    {isAdmin && (
                      <td className="py-2.5 px-2 border-t border-border-faint text-right whitespace-nowrap">
                        {isSelf ? null : removing === m.id ? (
                          <span className="inline-flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="danger"
                              loading={remove.isPending}
                              onClick={() => remove.mutate({ userId: m.id })}
                            >
                              Remove {m.name.split(' ')[0]}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => setRemoving(m.id)}
                          >
                            Remove…
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <p className="mt-3 text-[12px] text-ink-2b leading-relaxed max-w-[560px]">
            Removing someone ends their access immediately and frees their seat. Any deals they owned stay
            in the workspace, unassigned, and the activity trail keeps everything they did. API keys they
            created are not revoked — those belong to the workspace, so review them under Integrations.
          </p>
        )}
        </>
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
    onSuccess: (res) => {
      setCurrent('');
      setNext('');
      setConfirm('');
      /**
       * Changing the password ends every session on the account, so this tab's
       * own token has just been invalidated too. Swapping in the replacement is
       * what stops the next request 401-ing and dumping the user back at the
       * login screen a second after they did the right thing.
       */
      const principal = getPrincipal();
      if (principal) setSession(res.token, principal);
      toast.success('Password changed — you’re signed out everywhere else');
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
                      <tr key={e.id} className="hover:bg-sunken transition-colors">
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

/** Firm-level standing wording used by new terms of engagement and the reports. */
type PolicyForm = {
  aiPolicy: string;
  toePurpose: string;
  toeOtherUsers: string;
  toeInterest: string;
  toeExtentOfInvestigation: string;
  toeSourcesOfInformation: string;
  toeAssumptions: string;
  toeSpecialAssumptions: string;
  toeReportFormat: string;
  toeRestrictionsOnUse: string;
  toeFeeBasis: string;
  toeComplaintsProcedure: string;
  toeValuerReg: string;
};

const TOE_FIELDS: Array<[string, string, string]> = [
  ['toePurpose', 'Purpose of the valuation', 'Secured lending and internal decision-making…'],
  ['toeOtherUsers', 'Other intended users', 'None. This report is for the addressee client only…'],
  ['toeInterest', 'Interest to be valued', 'Freehold, with vacant possession assumed on completion.'],
  ['toeExtentOfInvestigation', 'Extent of investigation', 'The valuer will inspect the property internally and externally…'],
  ['toeSourcesOfInformation', 'Nature and source of information', 'Areas, schedules and cost information supplied by the client…'],
  ['toeAssumptions', 'Assumptions', 'Good and marketable title is held free from onerous restrictions…'],
  ['toeSpecialAssumptions', 'Special assumptions', 'None.'],
  ['toeReportFormat', 'Format of the report', 'A written valuation report in the firm’s standard Red Book format…'],
  ['toeRestrictionsOnUse', 'Restrictions on use', 'The report may not be reproduced or relied upon by any third party…'],
  ['toeFeeBasis', 'Basis of fees', 'A fixed fee as separately quoted, payable on delivery…'],
  ['toeComplaintsProcedure', 'Complaints handling', 'The firm operates a complaints handling procedure…'],
];

/**
 * Faults, from the server and from customers' browsers (`CLIENT`). Admin-only,
 * and empty most of the time — which is the point: a panel that is normally
 * blank is read the moment it is not.
 */
function ErrorsPanel() {
  const { data, isLoading } = trpc.org.errors.useQuery({ limit: 25 });
  if (isLoading) return null;
  if (!data?.length) return null;
  return (
    <Panel title="Recorded faults" right={<StatusChip status="amber" label={`${data.length}`} />}>
      <div className="flex flex-col gap-2">
        {data.map((e) => (
          <div key={e.id} className="text-[12px]">
            <div className="flex items-baseline gap-2">
              <span className="fig text-ink-3">{e.method}</span>
              <span className="fig flex-1 min-w-0 truncate">{e.path}</span>
              {e.count > 1 && <span className="fig text-ink-3">×{e.count}</span>}
              <span className="fig text-[10.5px] text-ink-3">
                {new Date(e.lastAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
            <div className="text-[11.5px] text-ink-2">{e.message}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[10.5px] text-ink-3">
        Credentials are stripped before storage. Kept on this server — nothing is sent to a third party.
      </div>
    </Panel>
  );
}

function PolicyPanel({ isAdmin }: { isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: policy, isLoading } = trpc.org.policy.useQuery();
  const [form, setForm] = useState<Record<string, string> | null>(null);
  /**
   * The stamp of the policy this panel loaded, so a second admin's save is
   * refused rather than silently restoring seventeen clauses.
   *
   * Refreshed from the SAVE's own response, never re-read from the query: the
   * drawer in `a48b7b3` re-read it from a list that had not refetched yet, and
   * refused its own user's second edit as a conflict with themselves.
   */
  const [stamp, setStamp] = useState<Date | null>(null);
  const [cap, setCap] = useState<string>('');
  const [open, setOpen] = useState(false);
  // held as strings so an empty box stays empty: "" means no covenant, and a
  // number state would turn that into 0 — a limit of zero, which every deal breaches
  const [covenantText, setCovenantText] = useState({ covLtgdvMaxPct: '', covLtcMaxPct: '', covMinProfitOnCostPct: '' });

  useEffect(() => {
    if (policy && !form) {
      const { updatedAt, toeLiabilityCap, covLtgdvMaxPct, covLtcMaxPct, covMinProfitOnCostPct, ...rest } = policy;
      setForm(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? '')])));
      setStamp(updatedAt ? new Date(updatedAt) : null);
      setCap(toeLiabilityCap == null ? '' : String(toeLiabilityCap));
      setCovenantText({
        covLtgdvMaxPct: covLtgdvMaxPct == null ? '' : String(covLtgdvMaxPct),
        covLtcMaxPct: covLtcMaxPct == null ? '' : String(covLtcMaxPct),
        covMinProfitOnCostPct: covMinProfitOnCostPct == null ? '' : String(covMinProfitOnCostPct),
      });
    }
  }, [policy, form]);

  // "" → null (no covenant), never 0
  const covNum = (v: string) => (v.trim() === '' ? null : Number.parseFloat(v));

  const save = trpc.org.savePolicy.useMutation({
    onSuccess: (res) => {
      setStamp(res.updatedAt ? new Date(res.updatedAt) : null);
      utils.org.policy.invalidate();
      toast.success('Firm policy saved — new terms will draft from it');
    },
  });

  if (isLoading || !form) {
    return (
      <Panel title="Valuation policy">
        <SkeletonRows rows={4} />
      </Panel>
    );
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...(f ?? {}), [k]: v }));

  return (
    <Panel
      title="Valuation policy"
      right={
        isAdmin ? (
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                ...(form as unknown as PolicyForm),
                toeLiabilityCap: cap.trim() === '' ? null : parseFloat(cap) || 0,
                covLtgdvMaxPct: covNum(covenantText.covLtgdvMaxPct),
                covLtcMaxPct: covNum(covenantText.covLtcMaxPct),
                covMinProfitOnCostPct: covNum(covenantText.covMinProfitOnCostPct),
                expectedUpdatedAt: stamp ?? undefined,
              })
            }
          >
            Save policy
          </Button>
        ) : undefined
      }
    >
      <div className="text-[13.5px] font-semibold">AI policy note</div>
      <div className="mt-1 text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
        Added to the AI-use disclosure in every report, after the standing statement. Use it for your own commitments —
        how AI-assisted text is reviewed, where your full policy can be read.
      </div>
      <textarea
        className="w-full mt-2.5 text-[12.5px] leading-[1.55]"
        rows={3}
        aria-label="AI policy note"
        disabled={!isAdmin}
        placeholder="e.g. All AI-assisted text is reviewed and adopted by the signing valuer. Our full AI policy is available on request."
        value={form.aiPolicy ?? ''}
        onChange={(e) => set('aiPolicy', e.target.value)}
      />
      <div className="mt-2 rounded-[10px] bg-sunken-2 px-3 py-2.5 text-[11.5px] text-ink-2 leading-snug">
        The statement that no AI computed, adjusted or approved any figure is not editable — it is a fact about how the
        engine works, not a policy position.
      </div>

      <div className="mt-5 border-t border-border-std pt-4">
        <button
          type="button"
          className="flex items-center gap-2 text-[13.5px] font-semibold"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="text-ink-3">{open ? '▾' : '▸'}</span> Terms of engagement — house style
        </button>
        <div className="mt-1 text-[12px] text-ink-2b leading-relaxed max-w-[620px]">
          New terms draft from these. Leave a field blank and Apex&rsquo;s own wording is used; a valuer can still edit any
          clause on the deal itself.
        </div>
        {open && (
          <div className="mt-3 flex flex-col gap-3">
            {TOE_FIELDS.map(([key, label, placeholder]) => (
              <label key={key} className="block">
                <span className="label-mono text-ink-3 block mb-1">{label}</span>
                <textarea
                  className="w-full text-[12.5px] leading-[1.55]"
                  rows={2}
                  aria-label={label}
                  disabled={!isAdmin}
                  placeholder={placeholder}
                  value={form[key] ?? ''}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="label-mono text-ink-3 block mb-1">Valuer registration line</span>
                <input
                  className="w-full"
                  aria-label="Valuer registration line"
                  disabled={!isAdmin}
                  placeholder="RICS Registered Valuer"
                  value={form.toeValuerReg ?? ''}
                  onChange={(e) => set('toeValuerReg', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label-mono text-ink-3 block mb-1">Default liability cap (£)</span>
                <input
                  type="number"
                  className="w-full fig"
                  aria-label="Default liability cap"
                  disabled={!isAdmin}
                  placeholder="No stated cap"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              </label>
            </div>


          </div>
        )}

        {/* Facility covenants. Left blank they are NOT tested — the portfolio
            shows the ratios either way. Placeholders carry the market-standard
            figures as a starting point; nothing is applied until it is typed,
            because a breach against a limit nobody agreed to is an accusation,
            not a finding. */}
        <div className="mt-5 pt-4 border-t border-border-std">
          <div className="text-[12.5px] font-semibold">Facility covenants</div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            Leave blank and nothing is tested — the portfolio still shows where each deal stands.
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['covLtgdvMaxPct', 'Max loan to GDV (%)', '65'],
              ['covLtcMaxPct', 'Max loan to cost (%)', '70'],
              ['covMinProfitOnCostPct', 'Min profit on cost (%)', '15'],
            ] as Array<[keyof typeof covenantText, string, string]>).map(([key, label, suggestion]) => (
              <label key={key} className="block">
                <span className="label-mono text-ink-3 block mb-1">{label}</span>
                <input
                  type="number"
                  className="w-full fig"
                  aria-label={label}
                  disabled={!isAdmin}
                  placeholder={`Not set — typically ${suggestion}`}
                  value={covenantText[key]}
                  onChange={(e) => setCovenantText({ ...covenantText, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>

      </div>
      {!isAdmin && <div className="mt-3 text-[11.5px] text-ink-3">Only an admin can change the firm policy.</div>}
    </Panel>
  );
}

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
            className="font-semibold text-brand-ink hover:text-brand-ink"
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
          {data.trial.daysLeft != null && (
            <StatusChip
              status={data.trial.expired ? 'red' : data.trial.daysLeft <= 3 ? 'amber' : 'neutral'}
              label={data.trial.expired ? 'TRIAL ENDED' : `${data.trial.daysLeft} DAYS LEFT`}
            />
          )}
          <StatusChip status={data.plan === 'TRIAL' ? 'neutral' : 'green'} label={data.plan} />
        </span>
      }
    >
      {/*
        The clock, said out loud. A trial that ends is only fair if the end is
        visible beforehand — and when it has ended, the sentence people need is
        what they can still do, not what they have lost.
      */}
      {data.trial.endsAt && (
        <div
          className="mb-4 rounded-[12px] border p-3 text-[12.5px] leading-[1.6]"
          style={{
            borderColor: data.trial.expired ? 'rgb(var(--status-red, 178 58 46) / 0.4)' : 'rgb(var(--border-strong))',
            background: data.trial.expired ? 'rgb(var(--status-red-bg, 253 242 240))' : 'transparent',
          }}
        >
          {data.trial.expired ? (
            <>
              <strong className="font-semibold">Your trial has ended.</strong> Everything here stays readable, printable
              and exportable — choose a plan below to start editing again. Nothing has been deleted.
            </>
          ) : (
            <>
              <strong className="font-semibold">
                {data.trial.daysLeft} day{data.trial.daysLeft === 1 ? '' : 's'} left of your trial
              </strong>{' '}
              — it ends on{' '}
              {new Date(data.trial.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              , after which the workspace becomes read-only until you subscribe.
            </>
          )}
        </div>
      )}
      {/* Usage against allowance, shown whether or not Stripe is wired up: the
          limits are enforced by the API regardless, so hiding them behind billing
          configuration would let someone meet a wall they were never shown. */}
      <div className="mb-4 flex flex-wrap gap-5 border-b border-border-std pb-3">
        {([
          ['Deals', data.usage.deals],
          ['Team members', data.usage.members],
        ] as Array<[string, { used: number; limit: number | null }]>).map(([label, u]) => {
          const atLimit = u.limit != null && u.used >= u.limit;
          return (
            <div key={label}>
              <div className="text-[10.5px] uppercase tracking-wide text-ink-3">{label}</div>
              <div
                className="fig text-[14px] font-semibold"
                style={{ color: atLimit ? 'rgb(var(--status-red, 178 58 46))' : 'rgb(var(--ink, 22 32 27))' }}
              >
                {u.used}
                <span className="text-ink-3 font-medium"> / {u.limit ?? '∞'}</span>
              </div>
            </div>
          );
        })}
        {(data.usage.deals.limit != null && data.usage.deals.used >= data.usage.deals.limit) ||
        (data.usage.members.limit != null && data.usage.members.used >= data.usage.members.limit) ? (
          <div className="self-center text-[12px]" style={{ color: 'rgb(var(--status-red, 178 58 46))' }}>
            You're at your plan's limit — existing work is unaffected, but you can't add more until you upgrade.
          </div>
        ) : null}
      </div>

      {/* The tiers show whether or not Stripe is wired up. What you are on and
          what you could move to is information about YOUR account; only taking a
          payment needs a payment processor. Hiding the plans on an unconfigured
          server left self-hosted and pre-billing deployments with no pricing at
          all — and the limits are enforced either way. */}
      {!data.configured && (
        <div className="mb-3 text-[12.5px] text-ink-2">
          Stripe isn't configured on this server — set <code className="fig">STRIPE_SECRET_KEY</code> to enable
          subscriptions. Plan limits still apply.
        </div>
      )}
      <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {data.plans.map((p) => {
              const current = data.plan === p.key;
              return (
                <div
                  key={p.key}
                  className="rounded-card border p-4 flex flex-col"
                  style={{ borderColor: current ? 'rgb(var(--brand-ink, 20 80 59))' : 'rgb(var(--border-strong, 230 229 222))', background: current ? 'rgb(var(--sunken, 251 252 251))' : 'rgb(var(--surface, 255 255 255))' }}
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
                        <span className="text-brand-ink">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  {isAdmin && !current && data.configured && (
                    <Button
                      className="mt-3 w-full"
                      variant={p.featured ? 'primary' : 'secondary'}
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
          {data.configured && (
            <div className="mt-3 text-[10.5px] text-ink-3">
              Card payments are processed by Stripe Checkout — no card details touch this server.
              {data.mode === 'test' && ' Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.'}
            </div>
          )}
        </>
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
        <PortalAccessPanel isAdmin={isAdmin} />
        <PolicyPanel isAdmin={isAdmin} />
        {/* the three surfaces that let other systems talk to this one */}
        <SsoPanel isAdmin={isAdmin} />
        <XeroPanel isAdmin={isAdmin} />
        <BankPanel isAdmin={isAdmin} />
        <ApiKeysPanel isAdmin={isAdmin} />
        <WebhooksPanel isAdmin={isAdmin} />
        <DemoMailboxPanel isAdmin={isAdmin} />
        {isAdmin && <ErrorsPanel />}
        <SecurityPanel />
        {isAdmin && <DataPrivacyPanel />}
        <AboutPanel />
      </main>
    </div>
  );
}
