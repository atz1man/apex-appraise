import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { clearSession, getPrincipal, trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { Avatar, Button, Panel, Spinner, StatCard, StatusChip, TopBar } from '../components/ui';

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
        <div className="py-6 flex justify-center"><Spinner /></div>
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
            <input className="flex-1" value={draft} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending ? <Spinner /> : 'Save'}
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
        <label className="label-mono text-ink-3 block mb-1">Role</label>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || invite.isPending}>
          {invite.isPending ? <Spinner /> : 'Send invite'}
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
        <div className="py-6 flex justify-center"><Spinner /></div>
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
                    <td className="py-2.5 px-2 border-t border-border-faint text-[12.5px] text-ink-2">{m.email}</td>
                    <td className="py-2.5 px-2 border-t border-border-faint fig text-[12px] text-ink-2b">{dateGB(m.createdAt)}</td>
                    <td className="py-2.5 px-2 border-t border-border-faint">
                      {isAdmin && !isSelf ? (
                        <select
                          value={m.role}
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
        <input className="w-full mb-3" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label className="label-mono text-ink-3 block mb-1">New password</label>
        <input className="w-full mb-3" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label className="label-mono text-ink-3 block mb-1">Confirm new password</label>
        <input className="w-full mb-3" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="text-[12px] text-status-red mb-3">{error}</div>}
        <Button type="submit" disabled={!current || !next || !confirm || change.isPending}>
          {change.isPending ? <Spinner /> : 'Change password'}
        </Button>
      </form>
      <div className="mt-4 pt-4 border-t border-border-faint text-[12px] text-ink-2b leading-relaxed max-w-[460px]">
        Sessions last 12 hours. When a session expires you&rsquo;re signed out on all devices — changing your
        password here takes effect from your next sign-in.
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

export default function Settings() {
  const principal = getPrincipal();
  const isAdmin = principal?.role === 'ADMIN';

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Workspace settings"
        right={principal && <StatusChip status={roleTone(principal.role)} label={principal.role} />}
      />
      <main className="max-w-[980px] mx-auto px-6 py-8 flex flex-col gap-5">
        <OrganisationPanel isAdmin={isAdmin} />
        <MembersPanel isAdmin={isAdmin} selfId={principal?.userId ?? ''} />
        <SecurityPanel />
        <AboutPanel />
      </main>
    </div>
  );
}
