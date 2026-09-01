import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { status as statusTokens, neutral, brand, type StatusKey } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { fM, formatDelta } from '../lib/format';
import { firmDate, firmDay, firmToday, isPastDue } from '../lib/firm-day';
import { Avatar, Button, Dot, Drawer, EmptyState, Panel, ProgressBar, Skeleton, SkeletonRows, StatCard, StatusChip, Td, Th, TopBar } from '../components/ui';
import { useToast } from '../components/Toast';
import { DealNav } from '../components/DealNav';

type ContractorDraft = {
  name: string; trade: string; status: string; rating: string; nextCert: string; retentionRelease: string;
  timesheetRate: string; operatives: string;
};

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

// A photo's takenAt, a week commencing and a task's due date are DAYS, stored at
// UTC midnight. Formatting them with the reader's clock moved them — see
// lib/firm-day.ts. Instants elsewhere on this screen stay local, which is right
// for a timestamp.

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
  // today as the firm reckons it, for the due-date colour below
  const todayKey = useMemo(() => firmToday(), []);

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

  /**
   * The contractor register. These cards, and the dropdown on every package
   * row, rendered contractors for as long as the screen has existed; nothing
   * could create one, so a real workspace read "No contractors in your
   * organisation yet" with no way past it.
   */
  const toast = useToast();
  const [contractorSel, setContractorSel] = useState<string | null>(null); // id | 'new' | null
  const [cDraft, setCDraft] = useState<ContractorDraft | null>(null);
  const [cRemoving, setCRemoving] = useState(false);
  const closeContractor = () => {
    setContractorSel(null);
    setCDraft(null);
    setCRemoving(false);
  };
  const createContractor = trpc.cost.createContractor.useMutation({
    onSuccess: (c) => {
      utils.cost.contractors.invalidate();
      closeContractor();
      toast.success(`${c.name} added`);
    },
  });
  const updateContractor = trpc.cost.updateContractor.useMutation({
    onSuccess: (c) => {
      utils.cost.contractors.invalidate();
      closeContractor();
      toast.success(`${c.name} updated`);
    },
  });
  const deleteContractor = trpc.cost.deleteContractor.useMutation({
    onSuccess: (res, vars) => {
      const gone = (contractors ?? []).find((c) => c.id === vars.id);
      utils.cost.contractors.invalidate();
      utils.cost.packages.invalidate(dealId);
      utils.photos.list.invalidate(dealId);
      closeContractor();
      toast.success(gone ? `${gone.name} removed` : 'Contractor removed');
      if (res.detachedPackages > 0 || res.detachedPhotos > 0) {
        toast.push('info', `${res.detachedPackages} package${res.detachedPackages === 1 ? '' : 's'} and ${res.detachedPhotos} photo${res.detachedPhotos === 1 ? '' : 's'} no longer name a contractor.`);
      }
    },
  });
  const openContractor = (c: NonNullable<typeof contractors>[number] | 'new') => {
    setCRemoving(false);
    if (c === 'new') {
      setContractorSel('new');
      setCDraft({ name: '', trade: '', status: 'On site', rating: '', nextCert: '', retentionRelease: '50% at PC', timesheetRate: '', operatives: '' });
      return;
    }
    setContractorSel(c.id);
    setCDraft({
      name: c.name, trade: c.trade, status: c.status, rating: c.rating === '—' ? '' : c.rating,
      nextCert: c.nextCert === '—' ? '' : c.nextCert, retentionRelease: c.retentionRelease,
      timesheetRate: c.timesheetRate == null ? '' : String(c.timesheetRate), operatives: c.operatives == null ? '' : String(c.operatives),
    });
  };
  /** an update is a patch: only what changed is sent, so a colleague's edit to another field survives */
  const saveContractor = () => {
    if (!cDraft) return;
    const rate = cDraft.timesheetRate.trim() === '' ? null : Number(cDraft.timesheetRate);
    const ops = cDraft.operatives.trim() === '' ? null : Number(cDraft.operatives);
    if (contractorSel === 'new') {
      createContractor.mutate({
        name: cDraft.name.trim(), trade: cDraft.trade.trim(), status: cDraft.status.trim() || 'On site',
        rating: cDraft.rating.trim() || '—', nextCert: cDraft.nextCert.trim() || '—',
        retentionRelease: cDraft.retentionRelease.trim() || '50% at PC', timesheetRate: rate, operatives: ops,
      });
      return;
    }
    const cur = (contractors ?? []).find((c) => c.id === contractorSel);
    if (!cur) return;
    const patch: Parameters<typeof updateContractor.mutate>[0]['patch'] = {};
    if (cDraft.name.trim() !== cur.name) patch.name = cDraft.name.trim();
    if (cDraft.trade.trim() !== cur.trade) patch.trade = cDraft.trade.trim();
    if (cDraft.status.trim() !== cur.status) patch.status = cDraft.status.trim();
    if ((cDraft.rating.trim() || '—') !== cur.rating) patch.rating = cDraft.rating.trim() || '—';
    if ((cDraft.nextCert.trim() || '—') !== cur.nextCert) patch.nextCert = cDraft.nextCert.trim() || '—';
    if (cDraft.retentionRelease.trim() !== cur.retentionRelease) patch.retentionRelease = cDraft.retentionRelease.trim();
    if (rate !== cur.timesheetRate) patch.timesheetRate = rate;
    if (ops !== cur.operatives) patch.operatives = ops;
    if (Object.keys(patch).length === 0) {
      closeContractor();
      return;
    }
    updateContractor.mutate({ id: cur.id, patch });
  };
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

  // close the photo lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const packages = cost?.packages ?? [];
  const rollup = cost?.rollup;
  const over = (rollup?.variance ?? 0) > 0;
  /** no appraisal saved means no baseline — a variance of zero would be a claim */
  const hasBaseline = rollup?.appraisedBuild != null;

  const gradOf = useMemo(() => {
    const m = new Map<string, string>();
    (contractors ?? []).forEach((c, i) => m.set(c.id, GRADS[i % GRADS.length]));
    return (id: string | null) => (id ? m.get(id) ?? GRAD_NONE : GRAD_NONE);
  }, [contractors]);

  const overs = packages.filter((p) => p.forecast > p.budget);
  const openTasks = (tasks ?? []).filter((t) => !t.done).length;

  /**
   * All four come from the engine now.
   *
   * They were worked out here, and `retentionHeld` — money withheld from a
   * builder — was worked out AGAIN on the server for the contractor list. One
   * rule, two implementations, one edit away from the two screens disagreeing
   * about what the firm owes. `packages/appraisal-engine` is where "ALL money
   * maths lives", and `cost-report.ts` already owned the variance beside them.
   *
   * The engine returns null for the two ratios when there is nothing to divide
   * by, which is an absence rather than a zero; the `?? 0` here is only reached
   * while the rollup is loading, since the panel that shows them is already
   * gated on the job having packages.
   */
  const weightedProgress = rollup?.weightedProgressPct ?? 0;
  const drawdown = rollup?.drawdownPct ?? 0;
  const retentionHeld = rollup?.retentionHeld ?? 0;
  const retentionAtCompletion = rollup?.retentionAtCompletion ?? 0;
  const certificates = rollup?.certificates ?? 0;

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
        <DealNav dealId={dealId} active="costs" />
        <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
          {/* KPI strip skeleton */}
          <div className="mt-5 flex gap-3 flex-wrap">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                <Skeleton height={10} width="60%" />
                <Skeleton height={21} width="75%" className="mt-2.5" />
              </div>
            ))}
          </div>
          {/* package table + side rail skeleton */}
          <div className="mt-5 grid grid-cols-1 gap-4 items-start lg:[grid-template-columns:minmax(0,1fr)_340px]">
            <Panel>
              <SkeletonRows rows={7} height={18} />
            </Panel>
            <aside className="flex flex-col gap-4">
              <Panel>
                <SkeletonRows rows={5} />
              </Panel>
            </aside>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-ink">Pipeline</Link> / {deal?.name ?? '…'} / Cost monitoring
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

      <DealNav dealId={dealId} active="costs" />
      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
        {packages.length === 0 ? (
          // no cost plan yet — one guided empty state instead of a wall of dashes
          <div className="mt-5">
            <EmptyState
              title="No cost plan on this deal yet"
              cta={<Button to={`/deal/${dealId}/appraisal`}>Open the appraisal →</Button>}
            >
              Cost monitoring lights up once the build cost plan is broken out into packages —
              budgets, contractor commitments and variance alerts all flow from the appraisal.
            </EmptyState>
          </div>
        ) : (
          <>
        {/* KPI strip */}
        <div className="mt-5 flex gap-3 flex-wrap">
          {/*
            "Appraised cost" is the appraisal's construction cost. It used to be
            the sum of the package budget fields — the packages measured against
            themselves — while this very subtitle claimed it came from the
            appraisal. Measured: £9.71m of packages shown as the appraised cost
            of a scheme appraised at £6.86m.
          */}
          <StatCard
            label="Appraised cost"
            value={hasBaseline ? fM(rollup!.appraisedBuild!) : '—'}
            sub={hasBaseline ? 'construction, current appraisal' : 'no appraisal saved'}
          />
          <StatCard
            label="Package budgets"
            value={packages.length ? fM(rollup!.packageBudgets) : '—'}
            sub={
              hasBaseline && packages.length
                ? rollup!.unallocated! >= 0
                  ? `${fM(rollup!.unallocated!)} not yet packaged`
                  : `${fM(-rollup!.unallocated!)} over the appraised cost`
                : undefined
            }
          />
          <StatCard label="Committed" value={packages.length ? fM(rollup!.committed) : '—'} />
          <StatCard label="Forecast final" value={packages.length ? fM(rollup!.forecast) : '—'} />
          <div className="flex-1 min-w-[150px] rounded-card shadow-rest px-4 py-3.5" style={{ background: hasBaseline && packages.length ? (over ? statusTokens.red.bg : statusTokens.green.bg) : 'rgb(var(--surface, 255 255 255))', border: `1px solid ${neutral.borderStrong}` }}>
            <div className="label-mono" style={{ color: hasBaseline && packages.length ? varTone(rollup!.variance!) : neutral.ink3 }}>Variance to appraisal</div>
            <div className="fig mt-1.5 text-[21px] font-semibold tracking-[-1px]" style={{ color: hasBaseline && packages.length ? varTone(rollup!.variance!) : neutral.ink3 }}>
              {hasBaseline && packages.length ? formatDelta(rollup!.variance!) : '—'}
            </div>
            {!hasBaseline && <div className="mt-0.5 text-[11px] text-ink-3">save an appraisal to measure against</div>}
          </div>
          <StatCard
            label="Profit impact"
            value={hasBaseline && packages.length ? formatDelta(rollup!.profitImpact!) : '—'}
            sub={hasBaseline && rollup!.contingency ? `after ${fM(rollup!.contingency)} contingency` : undefined}
            tone={hasBaseline && packages.length ? (rollup!.profitImpact! < 0 ? statusTokens.red.text : rollup!.profitImpact! > 0 ? statusTokens.green.text : undefined) : undefined}
          />
          <StatCard label="Open actions" value={String(openTasks)} tone={openTasks > 0 ? undefined : statusTokens.green.text} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 items-start lg:[grid-template-columns:minmax(0,1fr)_340px]">
          {/* Cost report */}
          <Panel title="Cost report — packages & contractors" right={<span className="text-[11.5px] text-ink-3">Forecast vs package budget</span>}>
            {packages.length === 0 ? (
              <EmptyState>No cost packages for this deal yet — packages appear once the build cost plan is broken out.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
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
                      <tr key={pk.id} className="hover:bg-sunken transition-colors">
                        <Td className="font-medium text-[13px] pr-2">{pk.name}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <GradDot grad={gradOf(pk.contractorId)} label={pk.contractor ? initialsOf(pk.contractor.name) : '—'} />
                            <select
                              className="h-[30px] py-0 text-[11.5px] min-w-0 flex-1"
                              aria-label={`Contractor for ${pk.name}`}
                              value={pk.contractorId ?? ''}
                              disabled={upsertPkg.isPending}
                              onChange={(e) =>
                                // ONLY the contractor. Sending the row's figures
                                // back would revert whatever the ledger sync had
                                // brought in since this page loaded — see
                                // cost.upsertPackage
                                upsertPkg.mutate({
                                  id: pk.id,
                                  dealId,
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
                    {/* the packages' own budgets — the appraisal baseline is the KPI above */}
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.packageBudgets)}</Td>
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.committed)}</Td>
                    <Td right fig className="font-semibold text-ink-2b">{fM(rollup!.spent)}</Td>
                    <Td right fig className="font-bold">{fM(rollup!.forecast)}</Td>
                    <Td right fig className="font-bold" style={{ color: varTone(rollup!.forecast - rollup!.packageBudgets) }}>{formatDelta(rollup!.forecast - rollup!.packageBudgets)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              </table>
              </div>
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
                  {/*
                    * Two retention figures, because they answer two questions
                    * and this line used to answer the wrong one. "Held" is what
                    * has been deducted from payments already certified — the
                    * liability the firm owes today, which belongs on a panel of
                    * to-date figures. "At completion" is the whole-contract
                    * amount that used to sit under this heading.
                    */}
                  <div className="flex justify-between text-[12.5px] text-ink-2b border-t border-border-faint pt-2.5">
                    <span>Retention held</span>
                    <span className="fig font-semibold text-ink">{fM(retentionHeld)}</span>
                  </div>
                  <div className="flex justify-between text-[11.5px] text-ink-3">
                    <span>At completion</span>
                    <span className="fig font-semibold">{fM(retentionAtCompletion)}</span>
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
          </>
        )}

        {/* ===== Contractors & actions ===== */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3.5 gap-4 flex-wrap">
            <h2 className="text-[17px] font-bold tracking-[-0.4px]">Contractors & actions</h2>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-ink-3">Contract value, retention, certificates & weekly timesheets per contractor.</span>
              <Button writes size="sm" variant="secondary" onClick={() => openContractor('new')}>Add contractor</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 items-start lg:[grid-template-columns:minmax(0,1fr)_340px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(contractors ?? []).length === 0 && <div className="col-span-full"><EmptyState>No contractors in your organisation yet — add one and it can be assigned to any package.</EmptyState></div>}
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
                          <div className="flex items-center gap-1.5 shrink-0">
                            <StatusChip status={chip.key} label={chip.label} />
                            <Button size="sm" variant="ghost" onClick={() => openContractor(c)} ariaLabel={`Edit ${c.name}`}>Edit</Button>
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
                          <span>{c.trade} · {pkgCount === 1 ? '1 package' : `${pkgCount} packages`}</span>
                          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: ratingTone(c.rating) }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill={ratingTone(c.rating)} aria-hidden="true"><path d="M12 2l2.6 7.2L22 9.6l-5.8 4.6L18 22l-6-4.2L6 22l1.8-7.8L2 9.6l7.4-.4L12 2Z" /></svg>
                            {c.rating}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                      {(
                        [
                          ['Contract', c.contractValue > 0 ? fM(c.contractValue) : '—', undefined],
                          // held so far, not the contract's eventual total: a
                          // contractor with no certificates has had nothing
                          // withheld, and this card showed them owed retention
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
                            {ops} {ops === 1 ? 'operative' : 'operatives'} × £{Math.round(rate)}/day → <b className="fig font-semibold text-brand-ink">{fM(weeklyLabour)}/wk</b>
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
                            aria-label={`Log hours for ${c.name}`}
                            placeholder="Log hours…"
                            value={hoursDraft[c.id] ?? ''}
                            onChange={(e) => setHoursDraft((s) => ({ ...s, [c.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && submitWeek(c.id)}
                          />
                          <Button variant="secondary" size="sm" disabled={logWeek.isPending} onClick={() => submitWeek(c.id)}>
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
                  <button
                    key={t.id}
                    className="flex items-center gap-2.5 py-1 px-1 -mx-1 rounded-[8px] text-left cursor-pointer hover:bg-sunken transition-colors disabled:opacity-50"
                    disabled={toggleTask.isPending}
                    onClick={() => toggleTask.mutate(t.id)}
                  >
                    <span
                      className="w-[16px] h-[16px] rounded-[5px] border inline-flex items-center justify-center shrink-0"
                      style={{ background: t.done ? brand[700] : '#fff', borderColor: t.done ? brand[700] : neutral.dashed }}
                    >
                      {t.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" aria-hidden="true"><path d="M4 12l5 5L20 7" /></svg>}
                    </span>
                    <span className="flex-1 text-[12px]" style={{ color: t.done ? neutral.ink3b : neutral.ink, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                    <span className="fig text-[10.5px]" style={{ color: !t.done && isPastDue(t.due, todayKey) ? statusTokens.red.text : neutral.ink3 }}>{t.due ? firmDay(t.due) : '—'}</span>
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
                    if (e.key === 'Enter' && taskDraft.trim() && !createTask.isPending) {
                      createTask.mutate({ dealId, title: taskDraft.trim(), aspect: 'Cost monitoring', assignee: taskWho });
                      setTaskDraft('');
                    }
                  }}
                />
                {['AO', 'DW', 'MV'].map((w) => (
                  <button key={w} aria-pressed={taskWho === w} onClick={() => setTaskWho(w)} className="rounded-full shrink-0 cursor-pointer" style={{ outline: taskWho === w ? `2px solid ${brand[700]}` : 'none', outlineOffset: 1 }}>
                    <Avatar initials={w} size={24} />
                  </button>
                ))}
                <Button
                  size="sm"
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
              <select className="h-8 py-0 text-[11.5px]" aria-label="Photo contractor" value={photoCid} onChange={(e) => setPhotoCid(e.target.value)}>
                <option value="">No contractor</option>
                {(contractors ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input type="date" className="h-8 py-0 fig text-[11.5px]" aria-label="Photo date" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} />
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
              />
              <Button writes variant="secondary" size="sm" loading={photoUploading} disabled={!photoCap.trim()} onClick={() => photoFileRef.current?.click()}>
                📷 Attach photo
              </Button>
              <Button writes size="sm" loading={addPhoto.isPending} disabled={!photoCap.trim()} onClick={submitPhoto}>+ Add entry</Button>
            </div>
          </div>

          {photoGroups.length === 0 && <EmptyState>No photos logged yet — add an entry above.</EmptyState>}
          {photoGroups.map((g) => (
            <div key={g.wc.getTime()} className="mb-5">
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="label-mono text-brand-ink" style={{ letterSpacing: '0.5px' }}>Week commencing {firmDate(g.wc)}</span>
                <span className="h-px flex-1 bg-border-strong" />
                <span className="fig text-[10.5px] text-ink-3">{g.items.length} {g.items.length === 1 ? 'photo' : 'photos'}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {g.items.map((ph, i) => (
                  <button key={ph.id} className="bg-surface border border-[rgb(var(--control-border))] rounded-card overflow-hidden text-left shadow-rest transition-all hover:-translate-y-0.5 hover:shadow-float" onClick={() => setLightbox(ph)}>
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
                        <span className="fig text-[10px] text-ink-3 shrink-0">{firmDay(ph.takenAt)}</span>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-10"
          style={{ background: 'rgba(12,18,14,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setLightbox(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.caption}
            className="w-[min(880px,90vw)] rounded-card overflow-hidden shadow-dark-card"
            style={{ background: neutral.ink }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white truncate">{lightbox.caption}</div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {lightbox.contractor ?? 'No contractor'} · {firmDate(lightbox.takenAt)}
                </div>
              </div>
              <button
                aria-label="Close"
                className="shrink-0 w-8 h-8 rounded-[9px] inline-flex items-center justify-center text-white cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                onClick={() => setLightbox(null)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
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

      {/* ===== Contractor — create / edit / remove ===== */}
      <Drawer
        open={!!contractorSel}
        onClose={closeContractor}
        width={520}
        title={contractorSel === 'new' ? 'New contractor' : (contractors ?? []).find((c) => c.id === contractorSel)?.name ?? 'Contractor'}
      >
        {cDraft && (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveContractor();
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Company</span>
                <input className="w-full" aria-label="Contractor name" value={cDraft.name} onChange={(e) => setCDraft({ ...cDraft, name: e.target.value })} placeholder="Kingsmead Plant Ltd" /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Trade</span>
                <input className="w-full" aria-label="Contractor trade" value={cDraft.trade} onChange={(e) => setCDraft({ ...cDraft, trade: e.target.value })} placeholder="Groundworks" /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Status</span>
                <select className="w-full" aria-label="Contractor status" value={cDraft.status} onChange={(e) => setCDraft({ ...cDraft, status: e.target.value })}>
                  {['Mobilising', 'On site', 'Off site', 'Complete'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Rating</span>
                <input className="w-full fig" aria-label="Contractor rating" value={cDraft.rating} onChange={(e) => setCDraft({ ...cDraft, rating: e.target.value })} placeholder="4.5" /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Next certificate</span>
                <input className="w-full" aria-label="Next certificate" value={cDraft.nextCert} onChange={(e) => setCDraft({ ...cDraft, nextCert: e.target.value })} placeholder="Cert 04 · 02 Jul" /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Retention release</span>
                <input className="w-full" aria-label="Retention release" value={cDraft.retentionRelease} onChange={(e) => setCDraft({ ...cDraft, retentionRelease: e.target.value })} /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Day rate (£, per operative)</span>
                <input type="number" min={0} className="w-full fig" aria-label="Day rate" value={cDraft.timesheetRate} onChange={(e) => setCDraft({ ...cDraft, timesheetRate: e.target.value })} placeholder="340" /></label>
              <label className="block"><span className="text-[11px] text-ink-3 block mb-1">Operatives</span>
                <input type="number" min={0} className="w-full fig" aria-label="Operatives" value={cDraft.operatives} onChange={(e) => setCDraft({ ...cDraft, operatives: e.target.value })} placeholder="6" /></label>
            </div>
            <div className="flex gap-2.5">
              <Button writes type="submit" className="flex-1" loading={createContractor.isPending || updateContractor.isPending} disabled={cDraft.name.trim().length < 2 || !cDraft.trade.trim()}>
                {contractorSel === 'new' ? 'Add contractor' : 'Save'}
              </Button>
              <Button variant="secondary" type="button" onClick={closeContractor}>Cancel</Button>
            </div>
            {contractorSel !== 'new' && (
              <div className="pt-3 border-t border-border-faint flex items-center gap-2 flex-wrap">
                {cRemoving ? (
                  <>
                    <span className="text-[11.5px] text-ink-2">Refused while a package holds money against them. Empty packages and photos are detached.</span>
                    <Button writes size="sm" variant="danger" loading={deleteContractor.isPending} onClick={() => contractorSel && deleteContractor.mutate({ id: contractorSel })}>Remove contractor</Button>
                    <Button size="sm" variant="secondary" type="button" onClick={() => setCRemoving(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" type="button" onClick={() => setCRemoving(true)}>Remove contractor…</Button>
                )}
              </div>
            )}
          </form>
        )}
      </Drawer>
    </div>
  );
}
