import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { status as statusTokens, neutral, brand, type StatusKey } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { fM, formatDelta } from '../lib/format';
import { Avatar, Button, Dot, EmptyState, Panel, ProgressBar, Spinner, StatCard, StatusChip, Td, Th, TopBar } from '../components/ui';

/** Contractor avatar gradients — per the design handoff prototype. */
const GRADS = [
  'linear-gradient(135deg,#1E7A55,#14503B)',
  'linear-gradient(135deg,#3C7FB5,#1F4E73)',
  'linear-gradient(135deg,#C79A4B,#8A6420)',
  'linear-gradient(135deg,#9B79C0,#5E3F86)',
];
const GRAD_NONE = 'linear-gradient(135deg,#9AA09A,#6E7269)';

/** Evergreen gradient placeholders for photo cards (no real images). */
const PHOTO_GRADS = [
  'linear-gradient(150deg,#1E7A55 0%,#14503B 60%,#0F3528 100%)',
  'linear-gradient(150deg,#5E9C80 0%,#1B6048 55%,#0C2A20 100%)',
  'linear-gradient(150deg,#7FB99E 0%,#1E7A55 50%,#13402F 100%)',
];

const initialsOf = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const contractorChip = (s: string): { key: StatusKey; label: string } =>
  s === 'On site'
    ? { key: 'green', label: 'ON SITE' }
    : s === 'Mobilising'
      ? { key: 'amber', label: 'MOBILISING' }
      : { key: 'neutral', label: s.toUpperCase() };

const ratingTone = (r: string) => {
  const v = parseFloat(r);
  if (Number.isNaN(v)) return neutral.ink3b;
  return v >= 4.5 ? statusTokens.green.text : v >= 4 ? statusTokens.amber.text : statusTokens.red.text;
};

const varTone = (v: number) => (v > 0 ? statusTokens.red.text : v < 0 ? statusTokens.green.text : neutral.ink3);

function GradDot({ grad, label, size = 22, radius = 6 }: { grad: string; label: string; size?: number; radius?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, borderRadius: radius, background: grad, fontSize: Math.max(7, size * 0.36) }}
    >
      {label}
    </span>
  );
}

export default function CostMonitoring() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();

  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: cost, isLoading } = trpc.cost.packages.useQuery(dealId, { enabled: !!dealId });
  const { data: contractors } = trpc.cost.contractors.useQuery();
  const { data: photos } = trpc.photos.list.useQuery(dealId, { enabled: !!dealId });
  const { data: tasks } = trpc.tasks.list.useQuery({ dealId, aspect: 'Cost monitoring' }, { enabled: !!dealId });

  const upsertPkg = trpc.cost.upsertPackage.useMutation({
    onSuccess: () => {
      utils.cost.packages.invalidate(dealId);
      utils.cost.contractors.invalidate();
    },
  });
  const logWeek = trpc.cost.logTimesheetWeek.useMutation({ onSuccess: () => utils.cost.contractors.invalidate() });
  const addPhoto = trpc.photos.add.useMutation({ onSuccess: () => utils.photos.list.invalidate(dealId) });
  const createTask = trpc.tasks.create.useMutation({ onSuccess: () => utils.tasks.list.invalidate() });
  const toggleTask = trpc.tasks.toggle.useMutation({ onSuccess: () => utils.tasks.list.invalidate() });

  type Photo = NonNullable<typeof photos>[number];

  // ---- local UI state ----
  const [hoursDraft, setHoursDraft] = useState<Record<string, string>>({});
  const [taskDraft, setTaskDraft] = useState('');
  const [taskWho, setTaskWho] = useState('AO');
  const [photoCap, setPhotoCap] = useState('');
  const [photoCid, setPhotoCid] = useState('');
  const [photoDate, setPhotoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  const packages = cost?.packages ?? [];
  const rollup = cost?.rollup;
  const over = (rollup?.variance ?? 0) > 0;

  const gradOf = useMemo(() => {
    const m = new Map<string, string>();
    (contractors ?? []).forEach((c, i) => m.set(c.id, GRADS[i % GRADS.length]));
    return (id: string | null) => (id ? m.get(id) ?? GRAD_NONE : GRAD_NONE);
  }, [contractors]);

  const overs = packages.filter((p) => p.forecast > p.budget);
  const openTasks = (tasks ?? []).filter((t) => !t.done).length;

  // programme & drawdown — progress-weighted spend
  const weightedProgress = rollup && rollup.appraised > 0 ? packages.reduce((a, p) => a + p.budget * p.progressPct, 0) / rollup.appraised : 0;
  const drawdown = rollup && rollup.forecast > 0 ? (rollup.spent / rollup.forecast) * 100 : 0;
  const retentionHeld = packages.reduce((a, p) => a + p.committed * (p.retentionPct / 100), 0);
  const certificates = packages.reduce((a, p) => a + p.certificates, 0);

  // photo log grouped by week commencing, newest first
  const photoGroups = useMemo(() => {
    const map = new Map<number, { wc: Date; items: Photo[] }>();
    for (const ph of photos ?? []) {
      const t = ph.weekCommencing.getTime();
      if (!map.has(t)) map.set(t, { wc: ph.weekCommencing, items: [] });
      map.get(t)!.items.push(ph);
    }
    return [...map.values()].sort((a, b) => b.wc.getTime() - a.wc.getTime());
  }, [photos]);

  const submitPhoto = () => {
    if (!photoCap.trim() || addPhoto.isPending) return;
    addPhoto.mutate({ dealId, caption: photoCap.trim(), contractorId: photoCid || null, takenAt: photoDate });
    setPhotoCap('');
  };

  // real image upload → API local/S3-compatible store; falls back to the gradient card style
  const photoFileRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const uploadPhoto = async (file: File) => {
    if (!photoCap.trim()) return;
    setPhotoUploading(true);
    try {
      const form = new FormData();
      form.append('dealId', dealId);
      form.append('caption', photoCap.trim());
      if (photoCid) form.append('contractorId', photoCid);
      form.append('takenAt', photoDate);
      form.append('file', file);
      const res = await fetch('/uploads/photo', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
        body: form,
      });
      if (res.ok) {
        setPhotoCap('');
        utils.photos.list.invalidate(dealId);
      }
    } finally {
      setPhotoUploading(false);
      if (photoFileRef.current) photoFileRef.current.value = '';
    }
  };

  const submitWeek = (contractorId: string) => {
    const h = parseFloat(hoursDraft[contractorId] ?? '');
    if (Number.isNaN(h) || h <= 0 || logWeek.isPending) return;
    logWeek.mutate({ contractorId, hours: h });
    setHoursDraft((s) => ({ ...s, [contractorId]: '' }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Cost monitoring" />
        <div className="mt-16 flex justify-center"><Spinner /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-700">Pipeline</Link> / {deal?.name ?? '…'} / Cost monitoring
          </span>
        }
        right={
          packages.length > 0 ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[11.5px] font-semibold"
              style={{ background: over ? statusTokens.red.bg : statusTokens.green.bg, color: over ? statusTokens.red.text : statusTokens.green.text }}
            >
              <Dot color={over ? statusTokens.red.dot : statusTokens.green.dot} /> {over ? 'Over appraisal' : 'On / under appraisal'}
            </span>
          ) : undefined
        }
      />

      <main className="max-w-[1640px] mx-auto px-6 pb-14">
        {/* KPI strip */}
        <div className="mt-5 flex gap-3 flex-wrap">
          <StatCard label="Appraised cost" value={packages.length ? fM(rollup!.appraised) : '—'} sub={cost?.hasAppraisal ? 'from current appraisal' : 'no appraisal saved'} />
          <StatCard label="Committed" value={packages.length ? fM(rollup!.committed) : '—'} />
          <StatCard label="Forecast final" value={packages.length ? fM(rollup!.forecast) : '—'} />
          <div className="flex-1 min-w-[150px] rounded-card shadow-rest px-4 py-3.5" style={{ background: packages.length ? (over ? statusTokens.red.bg : statusTokens.green.bg) : '#fff', border: `1px solid ${neutral.borderStrong}` }}>
            <div className="label-mono" style={{ color: packages.length ? varTone(rollup!.variance) : neutral.ink3 }}>Variance to appraisal</div>
            <div className="fig mt-1.5 text-[21px] font-semibold tracking-[-1px]" style={{ color: packages.length ? varTone(rollup!.variance) : neutral.ink3 }}>
              {packages.length ? formatDelta(rollup!.variance) : '—'}
            </div>
          </div>
          <StatCard
            label="Profit impact"
            value={packages.length ? formatDelta(rollup!.profitImpact) : '—'}
            tone={packages.length ? (rollup!.profitImpact < 0 ? statusTokens.red.text : rollup!.profitImpact > 0 ? statusTokens.green.text : undefined) : undefined}
          />
          <StatCard label="Open actions" value={String(openTasks)} tone={openTasks > 0 ? undefined : statusTokens.green.text} />
        </div>

        <div className="mt-5 grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
          {/* Cost report */}
          <Panel title="Cost report — packages & contractors" right={<span className="text-[11.5px] text-ink-3">Forecast vs appraised budget</span>}>
            {packages.length === 0 ? (
              <EmptyState>No cost packages for this deal yet — packages appear once the build cost plan is broken out.</EmptyState>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Package</Th>
                    <Th>Contractor</Th>
                    <Th right>Budget</Th>
                    <Th right>Committed</Th>
                    <Th right>Spent</Th>
                    <Th right>Forecast</Th>
                    <Th right>Variance</Th>
                    <Th className="pl-4">Progress</Th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pk) => {
                    const variance = pk.forecast - pk.budget;
                    return (
                      <tr key={pk.id}>
                        <Td className="font-medium text-[13px] pr-2">{pk.name}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <GradDot grad={gradOf(pk.contractorId)} label={pk.contractor ? initialsOf(pk.contractor.name) : '—'} />
                            <select
                              className="h-[30px] py-0 text-[11.5px] min-w-0 flex-1"
                              value={pk.contractorId ?? ''}
                              disabled={upsertPkg.isPending}
                              onChange={(e) =>
                                upsertPkg.mutate({
                                  id: pk.id,
                                  dealId,
                                  name: pk.name,
                                  budget: pk.budget,
                                  committed: pk.committed,
                                  spent: pk.spent,
                                  forecast: pk.forecast,
                                  progressPct: pk.progressPct,
                                  contractorId: e.target.value || null,
                                })
                              }
                            >
                              <option value="">Unassigned</option>
                              {(contractors ?? []).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        </Td>
                        <Td right fig className="text-ink-2b">{fM(pk.budget)}</Td>
                        <Td right fig className="text-ink-2b">{fM(pk.committed)}</Td>
                        <Td right fig className="text-ink-2b">{fM(pk.spent)}</Td>
                        <Td right fig className="font-semibold">{fM(pk.forecast)}</Td>
                        <Td right fig className="font-semibold" style={{ color: varTone(variance) }}>{formatDelta(variance)}</Td>
                        <Td className="pl-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-[60px]">
                              <ProgressBar pct={pk.progressPct} color={pk.progressPct >= 95 ? brand[500] : pk.progressPct >= 40 ? brand[700] : statusTokens.amber.dot} />
                            </div>
                            <span className="fig text-[10px] text-ink-3 w-8 text-right">{pk.progressPct}%</span>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-sunken">
                    <Td className="font-bold text-[13px]">Total construction</Td>
                    <Td />
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.appraised)}</Td>
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.committed)}</Td>
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.spent)}</Td>
                    <Td right fig className="font-bold">{fM(rollup!.forecast)}</Td>
                    <Td right fig className="font-bold" style={{ color: varTone(rollup!.variance) }}>{formatDelta(rollup!.variance)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              </table>
            )}
          </Panel>

          {/* side rail */}
          <aside className="flex flex-col gap-4">
            <Panel title="Programme & drawdown">
              {packages.length === 0 ? (
                <EmptyState>Nothing to draw down yet.</EmptyState>
              ) : (
                <div className="flex flex-col gap-3.5">
                  <div>
                    <div className="flex justify-between text-[12px] text-ink-2b">
                      <span>Build programme</span>
                      <span className="fig font-semibold text-ink">{Math.round(weightedProgress)}%</span>
                    </div>
                    <div className="mt-1.5"><ProgressBar pct={weightedProgress} color={brand[700]} height={7} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[12px] text-ink-2b">
                      <span>Spend drawn vs forecast</span>
                      <span className="fig font-semibold text-ink">{fM(rollup!.spent)} / {fM(rollup!.forecast)}</span>
                    </div>
                    <div className="mt-1.5"><ProgressBar pct={drawdown} color={statusTokens.blue.dot} height={7} /></div>
                  </div>
                  {/* progress-weighted spend curve, one bar per package */}
                  <div>
                    <div className="text-[12px] text-ink-2b">Spend by package</div>
                    <div className="mt-2 flex items-end gap-1.5 h-16">
                      {packages.map((pk) => {
                        const max = Math.max(...packages.map((x) => x.forecast), 1);
                        return (
                          <div key={pk.id} className="flex-1 flex flex-col justify-end h-full" title={`${pk.name} · spent ${fM(pk.spent)} of ${fM(pk.forecast)}`}>
                            <div className="rounded-t-[2px]" style={{ height: `${(pk.forecast / max) * 100}%`, background: neutral.border, position: 'relative' }}>
                              <div className="absolute bottom-0 left-0 right-0 rounded-t-[2px]" style={{ height: `${pk.forecast > 0 ? (pk.spent / pk.forecast) * 100 : 0}%`, background: brand[700] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex justify-between text-[12.5px] text-ink-2b border-t border-border-faint pt-2.5">
                    <span>Retention held</span>
                    <span className="fig font-semibold text-ink">{fM(retentionHeld)}</span>
                  </div>
                  <div className="flex justify-between text-[12.5px] text-ink-2b">
                    <span>Certificates issued</span>
                    <span className="fig font-semibold text-ink">{certificates}</span>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Variance alerts">
              {overs.length === 0 ? (
                <EmptyState>No packages forecast over budget.</EmptyState>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {overs.map((pk) => (
                    <div key={pk.id} className="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: statusTokens.red.bg }}>
                      <span className="mt-[5px]"><Dot color={statusTokens.red.dot} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold truncate" style={{ color: statusTokens.red.text }}>{pk.name}</span>
                          <StatusChip status="red" label={formatDelta(pk.forecast - pk.budget)} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-2b leading-snug">
                          Forecast {fM(pk.forecast)} against a {fM(pk.budget)} budget{pk.contractor ? ` — ${pk.contractor.name}` : ''}.
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </aside>
        </div>

        {/* ===== Contractors & actions ===== */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3.5 gap-4 flex-wrap">
            <h2 className="text-[17px] font-bold tracking-[-0.4px]">Contractors & actions</h2>
            <span className="text-[12px] text-ink-3">Contract value, retention, certificates & weekly timesheets per contractor.</span>
          </div>
          <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
            <div className="grid grid-cols-2 gap-4">
              {(contractors ?? []).length === 0 && <div className="col-span-2"><EmptyState>No contractors in your organisation yet.</EmptyState></div>}
              {(contractors ?? []).map((c) => {
                const chip = contractorChip(c.status);
                const pkgCount = packages.filter((p) => p.contractorId === c.id).length;
                const rate = c.timesheetRate ?? 0;
                const ops = c.operatives ?? 0;
                const weeklyLabour = ops * rate * 5;
                const hoursToDate = c.weeks.reduce((a, h) => a + h, 0);
                const thisWeek = c.weeks.length ? c.weeks[c.weeks.length - 1] : 0;
                const spark = c.weeks.slice(-8);
                const maxWk = Math.max(1, ...spark);
                const hasTs = ops > 0 || c.weeks.length > 0;
                return (
                  <Panel key={c.id} className="!p-[18px]">
                    <div className="flex items-start gap-3">
                      <GradDot grad={gradOf(c.id)} label={initialsOf(c.name)} size={42} radius={11} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[15px] font-semibold truncate">{c.name}</div>
                          <StatusChip status={chip.key} label={chip.label} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                          <span>{c.trade} · {pkgCount === 1 ? '1 package' : `${pkgCount} packages`}</span>
                          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ratingTone(c.rating) }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill={ratingTone(c.rating)}><path d="M12 2l2.6 7.2L22 9.6l-5.8 4.6L18 22l-6-4.2L6 22l1.8-7.8L2 9.6l7.4-.4L12 2Z" /></svg>
                            {c.rating}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                      {(
                        [
                          ['Contract', c.contractValue > 0 ? fM(c.contractValue) : '—', undefined],
                          ['Retention', c.retention > 0 ? fM(c.retention) : '—', statusTokens.amber.text],
                          ['Certificates', String(c.certificates), undefined],
                        ] as Array<[string, string, string | undefined]>
                      ).map(([l, v, tone]) => (
                        <div key={l} className="bg-sunken border border-border-std rounded-[10px] px-2.5 py-2">
                          <div className="label-mono text-ink-3">{l}</div>
                          <div className="fig mt-0.5 text-[13px] font-semibold" style={tone ? { color: tone } : undefined}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
                      <span>Next cert: <b className="font-semibold text-ink-2b">{c.nextCert ?? '—'}</b></span>
                      <span>Retention release: <b className="font-semibold text-ink-2b">{c.retentionRelease ?? '—'}</b></span>
                    </div>

                    {hasTs && (
                      <>
                        <div className="mt-3 pt-3 border-t border-border-faint flex items-center justify-between">
                          <span className="label-mono text-ink-3">Timesheets</span>
                          <span className="text-[11px] text-ink-3">
                            {ops} {ops === 1 ? 'operative' : 'operatives'} × £{Math.round(rate)}/day → <b className="fig font-semibold text-brand-700">{fM(weeklyLabour)}/wk</b>
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-3.5">
                          <div className="flex items-end gap-[3px] h-[34px] shrink-0">
                            {spark.length === 0 && <span className="text-[10.5px] text-ink-3b">No weeks logged</span>}
                            {spark.map((h, i) => (
                              <div key={i} className="w-2 rounded-t-[2px]" style={{ height: `${Math.max(6, (h / maxWk) * 100)}%`, background: i === spark.length - 1 ? brand[500] : '#AECBBC' }} title={`${h} h`} />
                            ))}
                          </div>
                          <div className="flex gap-4 flex-1">
                            {(
                              [
                                ['This week', `${thisWeek} h`],
                                ['Hours to date', `${hoursToDate} h`],
                                ['Labour cost', hoursToDate > 0 ? fM(hoursToDate * rate) : '—'],
                              ] as Array<[string, string]>
                            ).map(([l, v]) => (
                              <div key={l}>
                                <div className="label-mono text-ink-3">{l}</div>
                                <div className="fig mt-0.5 text-[13px] font-semibold">{v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            className="flex-1 min-w-0 h-[30px] py-0 fig text-[12px]"
                            placeholder="Log hours…"
                            value={hoursDraft[c.id] ?? ''}
                            onChange={(e) => setHoursDraft((s) => ({ ...s, [c.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && submitWeek(c.id)}
                          />
                          <Button variant="secondary" className="!h-[30px]" disabled={logWeek.isPending} onClick={() => submitWeek(c.id)}>
                            Log week
                          </Button>
                        </div>
                      </>
                    )}
                  </Panel>
                );
              })}
            </div>

            {/* Actions — cost monitoring tasks */}
            <Panel title="Actions — Cost monitoring" right={<span className="fig text-[11px] text-ink-3">{openTasks} open</span>}>
              <div className="flex flex-col gap-1.5">
                {(tasks ?? []).map((t) => (
                  <button key={t.id} className="flex items-center gap-2.5 py-1 text-left" onClick={() => toggleTask.mutate(t.id)}>
                    <span
                      className="w-[16px] h-[16px] rounded-[5px] border inline-flex items-center justify-center shrink-0"
                      style={{ background: t.done ? brand[700] : '#fff', borderColor: t.done ? brand[700] : neutral.dashed }}
                    >
                      {t.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2"><path d="M4 12l5 5L20 7" /></svg>}
                    </span>
                    <span className="flex-1 text-[12px]" style={{ color: t.done ? neutral.ink3b : neutral.ink, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                    <span className="fig text-[10.5px]" style={{ color: !t.done && t.due && t.due.getTime() < Date.now() ? statusTokens.red.text : neutral.ink3 }}>{t.due ? fmtDay(t.due) : '—'}</span>
                    <Avatar initials={t.assignee} size={20} />
                  </button>
                ))}
                {(tasks ?? []).length === 0 && <EmptyState>No cost-monitoring actions yet — raise one below.</EmptyState>}
              </div>
              <div className="mt-2.5 flex gap-1.5 items-center">
                <input
                  className="flex-1 min-w-0"
                  placeholder="Raise an action…"
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && taskDraft.trim()) {
                      createTask.mutate({ dealId, title: taskDraft.trim(), aspect: 'Cost monitoring', assignee: taskWho });
                      setTaskDraft('');
                    }
                  }}
                />
                {['AO', 'DW', 'MV'].map((w) => (
                  <button key={w} onClick={() => setTaskWho(w)} className="rounded-full shrink-0" style={{ outline: taskWho === w ? `2px solid ${brand[700]}` : 'none', outlineOffset: 1 }}>
                    <Avatar initials={w} size={24} />
                  </button>
                ))}
                <Button
                  className="!h-[32px] !px-2.5"
                  disabled={!taskDraft.trim() || createTask.isPending}
                  onClick={() => {
                    if (!taskDraft.trim()) return;
                    createTask.mutate({ dealId, title: taskDraft.trim(), aspect: 'Cost monitoring', assignee: taskWho });
                    setTaskDraft('');
                  }}
                >
                  +
                </Button>
              </div>
            </Panel>
          </div>
        </div>

        {/* ===== Site photo log ===== */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3.5 gap-4 flex-wrap">
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.4px]">Site photo log</h2>
              <div className="mt-0.5 text-[12px] text-ink-3">{(photos ?? []).length} {(photos ?? []).length === 1 ? 'photo' : 'photos'} · grouped by week, newest first. Persists with the deal.</div>
            </div>
            <div className="flex items-center gap-2 bg-surface border border-border-strong rounded-[12px] p-2 pl-3 flex-wrap">
              <input
                className="w-44 h-8 py-0 border-none shadow-none px-0 !bg-transparent"
                placeholder="Caption…"
                value={photoCap}
                onChange={(e) => setPhotoCap(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitPhoto()}
              />
              <select className="h-8 py-0 text-[11.5px]" value={photoCid} onChange={(e) => setPhotoCid(e.target.value)}>
                <option value="">No contractor</option>
                {(contractors ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input type="date" className="h-8 py-0 fig text-[11.5px]" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} />
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
              />
              <Button variant="secondary" className="!h-8" disabled={!photoCap.trim() || photoUploading} onClick={() => photoFileRef.current?.click()}>
                {photoUploading ? <Spinner /> : '📷 Attach photo'}
              </Button>
              <Button className="!h-8" disabled={!photoCap.trim() || addPhoto.isPending} onClick={submitPhoto}>+ Add entry</Button>
            </div>
          </div>

          {photoGroups.length === 0 && <EmptyState>No photos logged yet — add an entry above.</EmptyState>}
          {photoGroups.map((g) => (
            <div key={g.wc.getTime()} className="mb-5">
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="label-mono text-brand-700" style={{ letterSpacing: '0.5px' }}>Week commencing {fmtDate(g.wc)}</span>
                <span className="h-px flex-1 bg-border-strong" />
                <span className="fig text-[10.5px] text-ink-3">{g.items.length} {g.items.length === 1 ? 'photo' : 'photos'}</span>
              </div>
              <div className="grid grid-cols-4 gap-3.5">
                {g.items.map((ph, i) => (
                  <button key={ph.id} className="bg-surface border border-border-strong rounded-card overflow-hidden text-left shadow-rest transition-all hover:-translate-y-0.5 hover:shadow-float" onClick={() => setLightbox(ph)}>
                    {ph.url ? (
                      <img src={ph.url} alt={ph.caption} className="h-[130px] w-full object-cover" />
                    ) : (
                      <div className="h-[130px] flex items-end p-2.5" style={{ background: PHOTO_GRADS[i % PHOTO_GRADS.length] }}>
                        <span className="label-mono" style={{ color: 'rgba(255,255,255,0.75)' }}>Site photo</span>
                      </div>
                    )}
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-semibold truncate">{ph.caption}</span>
                        <span className="fig text-[10px] text-ink-3 shrink-0">{fmtDay(ph.takenAt)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                        <GradDot grad={gradOf(ph.contractorId)} label={ph.contractor ? initialsOf(ph.contractor) : '—'} size={14} radius={4} />
                        <span className="truncate">{ph.contractor ?? 'No contractor'}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ===== Lightbox ===== */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-10"
          style={{ background: 'rgba(12,18,14,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setLightbox(null)}
        >
          <div className="w-[min(880px,90vw)] rounded-card overflow-hidden shadow-dark-card" style={{ background: neutral.ink }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white truncate">{lightbox.caption}</div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {lightbox.contractor ?? 'No contractor'} · {fmtDate(lightbox.takenAt)}
                </div>
              </div>
              <button
                className="shrink-0 w-8 h-8 rounded-[9px] inline-flex items-center justify-center text-white"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                onClick={() => setLightbox(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {lightbox.url ? (
              <img src={lightbox.url} alt={lightbox.caption} className="max-h-[70vh] w-full object-contain bg-black" />
            ) : (
              <div className="h-[480px] flex items-center justify-center" style={{ background: PHOTO_GRADS[0] }}>
                <span className="label-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>Site photo — {lightbox.caption}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
