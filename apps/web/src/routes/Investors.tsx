import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPct } from '@apex/appraisal-engine';
import { trpc } from '../lib/trpc';
import { fM } from '../lib/format';
import { useToast } from '../components/Toast';
import { Avatar, Button, Drawer, EmptyState, Panel, SkeletonRows, StatCard, StatusChip, Td, Th, TopBar } from '../components/ui';

/**
 * The investor register — who has money in what, as the firm records it.
 *
 * The LP portal has worked for a long time: a position page, a cashflow list,
 * a capital-call panel, and an invitation under Settings → Portal access that
 * issues the login. Nothing could put an investor on the record, so on a real
 * workspace that picker was empty and the portal could be given to nobody.
 * The Hub's "Investor portal" card sent an internal user to the LP's own page,
 * which answered FORBIDDEN because they are not an LP.
 *
 * This is the firm's side of it. Every figure is the same one the LP reads,
 * scaled to their share the same way, because the register and the portal are
 * fed by one procedure.
 */

const dateGB = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);

type Details = { name: string; contactFirst: string; sharePct: number };
type HoldingDraft = { committed: string; called: string; distributed: string; irr: string };

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-3 block mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function Investors() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: rows, isLoading } = trpc.investors.list.useQuery();
  const { data: dealsQ } = trpc.deals.list.useQuery({});
  const deals = dealsQ?.deals ?? [];

  const [selected, setSelected] = useState<string | null>(null); // id | 'new' | null
  const [details, setDetails] = useState<Details | null>(null);
  const [removing, setRemoving] = useState(false);

  const isNew = selected === 'new';
  const record = trpc.investors.record.useQuery(selected ?? '', { enabled: !!selected && !isNew });
  const position = trpc.investors.get.useQuery(selected ?? '', { enabled: !!selected && !isNew });
  const rec = record.data;

  const refresh = (id?: string) => {
    void utils.investors.list.invalidate();
    if (id) {
      void utils.investors.record.invalidate(id);
      void utils.investors.get.invalidate(id);
    }
    // the Portal access picker under Settings reads the same register
    void utils.portalAccess.candidates.invalidate();
  };
  const close = () => {
    setSelected(null);
    setDetails(null);
    setRemoving(false);
  };

  const create = trpc.investors.create.useMutation({
    onSuccess: (row) => {
      refresh();
      setSelected(row.id);
      setDetails(null);
      toast.success(`${row.name} added to the register`);
    },
  });
  const update = trpc.investors.update.useMutation({
    onSuccess: (row) => {
      refresh(row.id);
      setDetails(null);
      toast.success('Investor updated');
    },
  });
  const remove = trpc.investors.delete.useMutation({
    onSuccess: (res, vars) => {
      const gone = (rows ?? []).find((r) => r.id === vars.id);
      refresh();
      close();
      toast.success(gone ? `${gone.name} removed from the register` : 'Investor removed');
      if (res.portalLogins > 0) {
        toast.push('info', `${res.portalLogins} portal login${res.portalLogins === 1 ? '' : 's'} went with them — ${res.portalLogins === 1 ? 'that person' : 'those people'} can no longer sign in.`);
      }
    },
  });

  // ---- holdings ----
  const [newHolding, setNewHolding] = useState<{ dealId: string; committed: string }>({ dealId: '', committed: '' });
  const [editingHolding, setEditingHolding] = useState<{ dealId: string; draft: HoldingDraft; base: HoldingDraft } | null>(null);
  const setHolding = trpc.investors.setHolding.useMutation({
    onSuccess: (h) => {
      refresh(h.investorId);
      setNewHolding({ dealId: '', committed: '' });
      setEditingHolding(null);
      toast.success('Holding saved');
    },
  });
  const removeHolding = trpc.investors.removeHolding.useMutation({
    onSuccess: (_r, vars) => {
      refresh(vars.investorId);
      toast.success('Holding removed');
    },
  });

  // ---- cashflow lines ----
  const [line, setLine] = useState<{ kind: 'dist' | 'call'; dealId: string; label: string; amount: string; date: string }>({
    kind: 'dist', dealId: '', label: '', amount: '', date: today(),
  });
  const recordLine = trpc.investors.recordCashflow.useMutation({
    onSuccess: (c) => {
      refresh(c.investorId);
      setLine({ kind: 'dist', dealId: '', label: '', amount: '', date: today() });
      toast.success(c.kind === 'call' ? 'Capital call issued' : 'Distribution recorded');
    },
  });
  const deleteLine = trpc.investors.deleteCashflow.useMutation({
    onSuccess: () => {
      if (selected) refresh(selected);
      toast.success('Line removed');
    },
  });

  const openRow = (id: string) => {
    setSelected(id);
    setDetails(null);
    setRemoving(false);
    setEditingHolding(null);
  };
  const openCreate = () => {
    setSelected('new');
    setDetails({ name: '', contactFirst: '', sharePct: 100 });
  };
  const openEdit = () => {
    if (!rec) return;
    setDetails({ name: rec.name, contactFirst: rec.contactFirst, sharePct: rec.sharePct });
  };
  /** only what changed — an update is a patch, so a colleague's edit to another field survives */
  const saveDetails = () => {
    if (!details) return;
    if (isNew) {
      create.mutate({ name: details.name.trim(), contactFirst: details.contactFirst.trim(), sharePct: details.sharePct });
      return;
    }
    if (!rec) return;
    const patch: { name?: string; contactFirst?: string; sharePct?: number } = {};
    if (details.name.trim() !== rec.name) patch.name = details.name.trim();
    if (details.contactFirst.trim() !== rec.contactFirst) patch.contactFirst = details.contactFirst.trim();
    if (details.sharePct !== rec.sharePct) patch.sharePct = details.sharePct;
    if (Object.keys(patch).length === 0) {
      setDetails(null);
      return;
    }
    update.mutate({ id: rec.id, patch });
  };

  const startHoldingEdit = (h: { dealId: string; committed: number; called: number; distributed: number; irr: number | null }) => {
    const base: HoldingDraft = {
      committed: String(h.committed), called: String(h.called), distributed: String(h.distributed),
      irr: h.irr == null ? '' : String(Math.round(h.irr * 1000) / 10),
    };
    setEditingHolding({ dealId: h.dealId, draft: { ...base }, base });
  };
  const saveHoldingEdit = () => {
    if (!editingHolding || !rec) return;
    const { draft, base, dealId } = editingHolding;
    const patch: { committed?: number; called?: number; distributed?: number; irr?: number | null } = {};
    if (draft.committed !== base.committed) patch.committed = num(draft.committed) ?? 0;
    if (draft.called !== base.called) patch.called = num(draft.called) ?? 0;
    if (draft.distributed !== base.distributed) patch.distributed = num(draft.distributed) ?? 0;
    // typed as a percentage; stored as a fraction. Blank clears the figure — a
    // deal whose IRR is unknown must not be sent as 0%
    if (draft.irr !== base.irr) patch.irr = draft.irr.trim() === '' ? null : Number(draft.irr) / 100;
    if (Object.keys(patch).length === 0) {
      setEditingHolding(null);
      return;
    }
    setHolding.mutate({ investorId: rec.id, dealId, ...patch });
  };

  const heldDeals = new Set((rec?.holdings ?? []).map((h) => h.dealId));
  const freeDeals = deals.filter((d) => !heldDeals.has(d.id));
  const pos = position.data?.position;
  const sel = (rows ?? []).find((r) => r.id === selected) ?? null;
  const busy = create.isPending || update.isPending;

  return (
    <div className="min-h-screen">
      <TopBar crumb="Investors" right={<Button writes size="sm" onClick={openCreate}>Add investor</Button>} />
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
        <div>
          <div className="eyebrow">Register</div>
          <h1 className="mt-1 text-[24px] font-bold tracking-[-0.6px]">Investors</h1>
          <p className="mt-1.5 text-[12.5px] text-ink-2 max-w-[640px] leading-relaxed">
            Every figure here is the one the investor reads on their own portal, scaled to their share the same way.
            Logins are issued under <Link to="/settings" className="text-brand-ink font-semibold">Settings → Portal access</Link>.
          </p>
        </div>

        <Panel title="Register" right={<StatusChip status={rows?.length ? 'green' : 'neutral'} label={`${rows?.length ?? 0} investors`} />}>
          {isLoading ? (
            <SkeletonRows rows={3} />
          ) : !rows?.length ? (
            <EmptyState>Nobody is on the register yet. Add an investor, give them a holding in a deal, and they can be invited to the portal.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Investor</Th>
                    <Th right>Share</Th>
                    <Th right>Committed</Th>
                    <Th right>Called</Th>
                    <Th right>Distributed</Th>
                    <Th right>Deals</Th>
                    <Th right>Logins</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-sunken cursor-pointer" onClick={() => openRow(r.id)}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar initials={r.initials} size={26} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold truncate">{r.name}</div>
                            {r.contactFirst && <div className="text-[10.5px] text-ink-3">{r.contactFirst}</div>}
                          </div>
                        </div>
                      </Td>
                      <Td right fig>{r.sharePct}%</Td>
                      <Td right fig>{r.committed > 0 ? fM(r.committed) : '—'}</Td>
                      <Td right fig>{r.called > 0 ? fM(r.called) : '—'}</Td>
                      <Td right fig>{r.distributed > 0 ? fM(r.distributed) : '—'}</Td>
                      <Td right fig>{r.holdings}</Td>
                      <Td right fig>{r.logins}</Td>
                      <Td right>
                        <Button size="sm" variant="ghost" onClick={() => openRow(r.id)} ariaLabel={`Open ${r.name}`}>
                          Open
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>

      <Drawer
        open={!!selected}
        onClose={close}
        width={560}
        title={
          isNew ? 'New investor' : sel ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar initials={sel.initials} size={28} />
              <span className="text-[17px] font-bold tracking-[-0.4px] truncate">{sel.name}</span>
              <StatusChip status="neutral" label={`${sel.sharePct}%`} />
            </div>
          ) : undefined
        }
      >
        {/* ---- details ---- */}
        {details ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveDetails();
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Investor name">
                <input className="w-full" aria-label="Investor name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="Meridian Capital LP" />
              </Field>
              <Field label="Contact first name">
                <input className="w-full" aria-label="Contact first name" value={details.contactFirst} onChange={(e) => setDetails({ ...details, contactFirst: e.target.value })} placeholder="Lena" />
              </Field>
              <Field label="Share of the LP base (%)">
                <input type="number" min={0} max={100} step={0.1} className="w-full fig" aria-label="Share of the LP base" value={details.sharePct} onChange={(e) => setDetails({ ...details, sharePct: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="text-[11px] text-ink-3">
              Every pooled figure — committed, called, distributed, each statement line — is scaled by this share before the investor sees it.
            </div>
            <div className="flex gap-2.5">
              <Button writes type="submit" className="flex-1" loading={busy} disabled={details.name.trim().length < 2 || details.sharePct < 0 || details.sharePct > 100}>
                {isNew ? 'Add to register' : 'Save'}
              </Button>
              <Button variant="secondary" type="button" onClick={() => (isNew ? close() : setDetails(null))}>Cancel</Button>
            </div>
          </form>
        ) : rec ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <div className="flex-1 text-[12.5px] text-ink-2">
                {rec.contactFirst ? `Contact: ${rec.contactFirst}` : 'No contact name recorded'}
                <div className="text-[11px] text-ink-3 mt-0.5">
                  {sel?.logins ? `${sel.logins} portal login${sel.logins === 1 ? '' : 's'}` : 'No portal login yet'} ·{' '}
                  <Link to="/settings" className="text-brand-ink font-semibold">Portal access</Link>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={openEdit}>Edit details</Button>
            </div>

            {pos && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatCard label="Committed" value={pos.committed > 0 ? fM(pos.committed) : '—'} />
                <StatCard label="Called" value={pos.called > 0 ? fM(pos.called) : '—'} />
                <StatCard label="DPI" value={pos.dpi != null ? `${pos.dpi.toFixed(2)}×` : '—'} />
                <StatCard label="Portfolio IRR" value={pos.portfolioIrr != null ? formatPct(pos.portfolioIrr, 1) : '—'} />
              </div>
            )}

            {/* ---- holdings ---- */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[13px] font-semibold">Holdings</h4>
                <span className="text-[11px] text-ink-3">100% LP basis · scaled by {rec.sharePct}% on the portal</span>
              </div>
              {rec.holdings.length === 0 ? (
                <div className="text-[12px] text-ink-3">No holding yet — an investor with no deal has nothing to read on the portal.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {rec.holdings.map((h) => {
                    const editing = editingHolding?.dealId === h.dealId ? editingHolding : null;
                    return (
                      <div key={h.id} className="rounded-card border border-border-faint px-3 py-2.5">
                        <div className="flex items-center gap-3 text-[12.5px]">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">{h.dealName}</div>
                            <div className="fig text-[11px] text-ink-3">
                              committed {fM(h.committed)} · called {h.called > 0 ? fM(h.called) : '—'} · distributed {h.distributed > 0 ? fM(h.distributed) : '—'}
                              {' · '}
                              {/* null is unrecorded; a recorded zero or a loss prints */}
                              IRR {h.irr != null ? formatPct(h.irr, 1) : 'not recorded'}
                            </div>
                          </div>
                          {!editing && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => startHoldingEdit(h)} ariaLabel={`Edit holding in ${h.dealName}`}>Edit</Button>
                              <Button
                                writes
                                size="sm"
                                variant="ghost"
                                disabled={h.moneyMoved || removeHolding.isPending}
                                title={h.moneyMoved ? 'Money has been called or distributed on this holding' : undefined}
                                onClick={() => {
                                  // one click used to take an investor's position in a deal off the register
                                  if (confirm(`Remove ${rec.name}'s holding in ${h.dealName}? Their position on this deal comes off the register.`)) {
                                    removeHolding.mutate({ investorId: rec.id, dealId: h.dealId });
                                  }
                                }}
                                ariaLabel={`Remove holding in ${h.dealName}`}
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </div>
                        {editing && (
                          <form
                            className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveHoldingEdit();
                            }}
                          >
                            <Field label="Committed (£)"><input type="number" min={0} className="w-full fig" aria-label="Committed" value={editing.draft.committed} onChange={(e) => setEditingHolding({ ...editing, draft: { ...editing.draft, committed: e.target.value } })} /></Field>
                            <Field label="Called (£)"><input type="number" min={0} className="w-full fig" aria-label="Called" value={editing.draft.called} onChange={(e) => setEditingHolding({ ...editing, draft: { ...editing.draft, called: e.target.value } })} /></Field>
                            <Field label="Distributed (£)"><input type="number" min={0} className="w-full fig" aria-label="Distributed" value={editing.draft.distributed} onChange={(e) => setEditingHolding({ ...editing, draft: { ...editing.draft, distributed: e.target.value } })} /></Field>
                            <Field label="Recorded IRR (%)"><input type="number" step={0.1} className="w-full fig" aria-label="Recorded IRR" placeholder="blank = not recorded" value={editing.draft.irr} onChange={(e) => setEditingHolding({ ...editing, draft: { ...editing.draft, irr: e.target.value } })} /></Field>
                            <div className="col-span-full flex gap-2">
                              <Button writes size="sm" type="submit" loading={setHolding.isPending}>Save holding</Button>
                              <Button size="sm" variant="secondary" type="button" onClick={() => setEditingHolding(null)}>Cancel</Button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {freeDeals.length > 0 && (
                <form
                  className="mt-2.5 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newHolding.dealId || !num(newHolding.committed)) return;
                    setHolding.mutate({ investorId: rec.id, dealId: newHolding.dealId, committed: Number(newHolding.committed) });
                  }}
                >
                  <Field label="Deal">
                    <select className="h-[36px] max-w-[240px]" aria-label="Deal for new holding" value={newHolding.dealId} onChange={(e) => setNewHolding({ ...newHolding, dealId: e.target.value })}>
                      <option value="">Choose…</option>
                      {freeDeals.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Committed (£)">
                    <input type="number" min={0} className="fig w-[150px]" aria-label="Committed for new holding" value={newHolding.committed} onChange={(e) => setNewHolding({ ...newHolding, committed: e.target.value })} />
                  </Field>
                  <Button writes size="sm" type="submit" className="mb-1" loading={setHolding.isPending} disabled={!newHolding.dealId || !(num(newHolding.committed)! > 0)}>
                    Add holding
                  </Button>
                </form>
              )}
            </section>

            {/* ---- statement lines ---- */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[13px] font-semibold">Distributions & capital calls</h4>
                <span className="text-[11px] text-ink-3">A call dated ahead is an open demand on the portal</span>
              </div>
              {rec.cashflows.length === 0 ? (
                <div className="text-[12px] text-ink-3">No statement lines yet.</div>
              ) : (
                <div className="flex flex-col">
                  {rec.cashflows.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 py-2 border-b border-border-faint last:border-b-0 text-[12.5px]">
                      <StatusChip status={c.kind === 'dist' ? 'green' : 'amber'} label={c.kind === 'dist' ? 'DIST' : 'CALL'} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{c.label}</div>
                        <div className="text-[11px] text-ink-3">{dateGB(c.date)}{c.dealId ? ` · ${deals.find((d) => d.id === c.dealId)?.name ?? ''}` : ''}</div>
                      </div>
                      <span className="fig font-semibold">{fM(Math.abs(c.amount))}</span>
                      {/* a call or a distribution is a financial record, and this
                          removed one on a single click with nothing said */}
                      <Button
                        writes
                        size="sm"
                        variant="ghost"
                        loading={deleteLine.isPending}
                        onClick={() => {
                          if (confirm(`Remove the ${c.kind === 'dist' ? 'distribution' : 'capital call'} “${c.label}” of ${fM(Math.abs(c.amount))}? It comes off ${rec.name}'s statement.`)) {
                            deleteLine.mutate({ cashflowId: c.id });
                          }
                        }}
                        ariaLabel={`Remove line ${c.label}`}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  const amount = num(line.amount);
                  if (!line.label.trim() || !amount || amount <= 0) return;
                  recordLine.mutate({
                    investorId: rec.id, dealId: line.dealId || null, kind: line.kind, label: line.label.trim(), amount, date: new Date(line.date),
                  });
                }}
              >
                <Field label="Kind">
                  <select className="w-full h-[36px]" aria-label="Line kind" value={line.kind} onChange={(e) => setLine({ ...line, kind: e.target.value as 'dist' | 'call' })}>
                    <option value="dist">Distribution</option>
                    <option value="call">Capital call</option>
                  </select>
                </Field>
                <Field label="Deal">
                  <select className="w-full h-[36px]" aria-label="Line deal" value={line.dealId} onChange={(e) => setLine({ ...line, dealId: e.target.value })}>
                    <option value="">—</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label={line.kind === 'call' ? 'Due' : 'Paid'}>
                  <input type="date" className="w-full" aria-label="Line date" value={line.date} onChange={(e) => setLine({ ...line, date: e.target.value })} />
                </Field>
                <Field label="Label">
                  <input className="w-full" aria-label="Line label" placeholder={line.kind === 'call' ? 'Capital call — drawdown 4' : 'Profit distribution'} value={line.label} onChange={(e) => setLine({ ...line, label: e.target.value })} />
                </Field>
                <Field label="Amount (£, 100% basis)">
                  <input type="number" min={0} className="w-full fig" aria-label="Line amount" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} />
                </Field>
                <Button writes size="sm" type="submit" className="mb-1" loading={recordLine.isPending} disabled={!line.label.trim() || !(num(line.amount)! > 0)}>
                  {line.kind === 'call' ? 'Issue call' : 'Record distribution'}
                </Button>
              </form>
            </section>

            {/* ---- removal ---- */}
            <div className="pt-3 border-t border-border-faint flex items-center gap-2 flex-wrap">
              {removing ? (
                <>
                  <span className="text-[11.5px] text-ink-2">Their portal login ends immediately. Refused while money has moved.</span>
                  <Button writes size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: rec.id })}>Remove investor</Button>
                  <Button size="sm" variant="secondary" onClick={() => setRemoving(false)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>Remove from register…</Button>
              )}
            </div>
          </div>
        ) : (
          <SkeletonRows rows={4} />
        )}
      </Drawer>
    </div>
  );
}
