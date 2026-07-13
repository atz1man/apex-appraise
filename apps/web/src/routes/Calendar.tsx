import { useMemo, useRef, useState } from 'react';
import { brand, neutral, status as statusTokens } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { Avatar, Button, Dot, EmptyState, EyebrowTitle, Panel, Skeleton, SkeletonRows, StatCard, TopBar } from '../components/ui';

// ---- Team (matches the seeded org users / design handoff) ----
const PEOPLE: Array<{ initials: string; name: string; short: string }> = [
  { initials: 'AO', name: 'Arthur O.', short: 'Arthur' },
  { initials: 'DW', name: 'Dana W.', short: 'Dana' },
  { initials: 'MV', name: 'Marcus V.', short: 'Marcus' },
  { initials: 'PA', name: 'Priya A.', short: 'Priya' },
];
/** Flat per-person accent for calendar pill dots — per the design handoff prototype. */
const FLAT: Record<string, string> = {
  AO: 'rgb(var(--status-green, 30 122 85))',
  DW: 'rgb(var(--status-blue, 45 91 168))',
  MV: 'rgb(var(--status-amber, 154 98 18))',
  PA: 'rgb(var(--status-purple, 107 78 138))',
};

const ASPECTS = ['Site visit', 'Comparables', 'Cost plan', 'Planning', 'Finance', 'Site purchase', 'Cashflow', 'Returns', 'Cost monitoring', 'General'];

const STAGE_ACCENT: Record<string, string> = {
  SOURCING: 'rgb(var(--ink-3, 154 160 154))',
  APPRAISAL: 'rgb(var(--stage-accent, 192 138 46))',
  OFFER: 'rgb(var(--status-blue, 45 91 168))',
  ACQUISITION: 'rgb(var(--status-green, 30 122 85))',
  CONSTRUCTION: '#14503B',
  SALES_LETTING: '#1E9E6A',
  COMPLETED: 'rgb(var(--ink-2b, 110 114 105))',
};

// ---- Date helpers (all local-time; en-GB) ----
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDue = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export default function Calendar() {
  const toast = useToast();
  const utils = trpc.useUtils();

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayKey = dayKey(today);

  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [filter, setFilter] = useState<string>('all');

  // add-task form
  const [title, setTitle] = useState('');
  const [dealId, setDealId] = useState('');
  const [aspect, setAspect] = useState('General');
  const [assignee, setAssignee] = useState('AO');
  const [due, setDue] = useState(todayKey);
  const titleRef = useRef<HTMLInputElement>(null);

  const { data: taskData, isLoading: tasksLoading } = trpc.tasks.list.useQuery({});
  const { data: dealData, isLoading: dealsLoading } = trpc.deals.list.useQuery({});

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      toast.success('Task added');
      setTitle('');
    },
  });
  const toggleTask = trpc.tasks.toggle.useMutation({ onSuccess: () => utils.tasks.list.invalidate() });

  const deals = dealData?.deals ?? [];
  const dealSel = dealId || deals[0]?.id || '';

  const allTasks = taskData ?? [];
  const tasks = useMemo(() => (filter === 'all' ? allTasks : allTasks.filter((t) => t.assignee === filter)), [allTasks, filter]);

  const isOverdue = (t: { done: boolean; due: Date | null }) => !t.done && !!t.due && startOfDay(t.due).getTime() < today.getTime();

  // ---- Calendar cells (Monday-first) ----
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const dim = new Date(view.y, view.m + 1, 0).getDate();
    const total = Math.ceil((offset + dim) / 7) * 7;
    const byDay = new Map<string, typeof tasks>();
    for (const t of tasks) {
      if (!t.due) continue;
      const k = dayKey(t.due);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(t);
    }
    return Array.from({ length: total }, (_, i) => {
      const dayNum = i - offset + 1;
      const inMonth = dayNum >= 1 && dayNum <= dim;
      const k = inMonth ? dayKey(new Date(view.y, view.m, dayNum)) : null;
      const dayTasks = (k ? byDay.get(k) : undefined) ?? [];
      // open tasks first, done last
      const sorted = [...dayTasks].sort((a, b) => Number(a.done) - Number(b.done));
      return { dayNum, inMonth, k, isToday: k === todayKey, tasks: sorted };
    });
  }, [view, tasks, todayKey]);

  // ---- Groups (Overdue / Today / This week / Later / Completed) ----
  const groups = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const weekEnd = today.getTime() + 7 * 86400000;
    const ts = (t: { due: Date | null }) => (t.due ? startOfDay(t.due).getTime() : Number.MAX_SAFE_INTEGER);
    const byDue = (a: { due: Date | null }, b: { due: Date | null }) => ts(a) - ts(b);
    const overdue = open.filter((t) => ts(t) < today.getTime()).sort(byDue);
    const dueToday = open.filter((t) => t.due && dayKey(t.due) === todayKey);
    const thisWeek = open.filter((t) => ts(t) > today.getTime() && ts(t) <= weekEnd).sort(byDue);
    const later = open.filter((t) => ts(t) > weekEnd).sort(byDue);
    const done = tasks.filter((t) => t.done);
    return {
      list: [
        { label: 'Overdue', color: statusTokens.red.text, tasks: overdue },
        { label: 'Today', color: brand[700], tasks: dueToday },
        { label: 'This week', color: brand[500], tasks: thisWeek },
        { label: 'Later', color: neutral.ink2b, tasks: later },
        { label: 'Completed', color: neutral.ink3, tasks: done },
      ],
      stats: { open: open.length, overdue: overdue.length, done: done.length },
    };
  }, [tasks, today, todayKey]);

  const milestones = deals.filter((d) => d.nextMilestone);

  const pickDay = (k: string) => {
    setDue(k);
    titleRef.current?.focus();
  };

  const submit = () => {
    const t = title.trim();
    if (!t || !dealSel || createTask.isPending) return;
    createTask.mutate({ dealId: dealSel, title: t, aspect, assignee, due });
  };

  const prev = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  if (tasksLoading || dealsLoading) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Calendar & tasks" />
        <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14" role="status" aria-label="Loading">
          <div className="mt-6">
            <Skeleton height={11} width={120} />
            <Skeleton height={27} width={260} className="mt-2" />
            <Skeleton height={13} width={380} className="mt-2.5" />
          </div>
          <div className="mt-5 grid gap-5 items-start lg:[grid-template-columns:minmax(0,1fr)_400px]">
            {/* month grid skeleton */}
            <div className="bg-surface border border-border-strong rounded-panel shadow-rest p-3 sm:p-5">
              <div className="flex items-center gap-3">
                <Skeleton height={20} width={160} />
                <Skeleton height={30} width={100} />
              </div>
              <div className="mt-4 grid grid-cols-7 gap-1.5">
                {Array.from({ length: 7 }, (_, i) => (
                  <Skeleton key={`w${i}`} height={10} />
                ))}
                {Array.from({ length: 35 }, (_, i) => (
                  <Skeleton key={i} height={96} />
                ))}
              </div>
            </div>
            {/* rail skeleton */}
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 flex-wrap lg:flex-nowrap">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex-1 min-w-[130px] bg-surface border border-border-strong rounded-card shadow-rest px-4 py-3.5">
                    <Skeleton height={10} width="60%" />
                    <Skeleton height={21} width="35%" className="mt-2" />
                  </div>
                ))}
              </div>
              <div className="bg-surface border border-border-strong rounded-panel shadow-rest p-4">
                <Skeleton height={34} />
                <div className="mt-2.5 flex gap-2">
                  <Skeleton height={34} className="flex-1" />
                  <Skeleton height={34} className="flex-1" />
                </div>
              </div>
              <div className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                <SkeletonRows rows={6} />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar crumb="Calendar & tasks" />
      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-6">
          <EyebrowTitle
            eyebrow="Team operations"
            title="Calendar & tasks"
            sub="Every task and deal milestone across the pipeline, in one place."
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-ink-3">Team</span>
                {[{ initials: 'all', name: 'Whole team', short: 'All' }, ...PEOPLE].map((p) => {
                  const on = filter === p.initials;
                  return (
                    <button
                      key={p.initials}
                      title={p.name}
                      onClick={() => setFilter(p.initials)}
                      aria-pressed={on}
                      className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[9px] border transition-colors cursor-pointer"
                      style={{
                        background: on ? neutral.tintSuccess : neutral.surface,
                        borderColor: on ? 'rgb(var(--border-green-soft, 214 230 221))' : neutral.borderStrong,
                        color: on ? brand[700] : neutral.ink2b,
                      }}
                    >
                      {p.initials === 'all' ? (
                        <span className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-white text-[8.5px] font-semibold" style={{ background: neutral.ink3 }}>∗</span>
                      ) : (
                        <Avatar initials={p.initials} size={18} />
                      )}
                      <span className="text-[11.5px] font-medium">{p.short}</span>
                    </button>
                  );
                })}
              </div>
            }
          />
        </div>

        <div className="mt-5 grid gap-5 items-start lg:[grid-template-columns:minmax(0,1fr)_400px]">
          {/* ===== Month grid ===== */}
          <Panel className="!p-3 sm:!p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-[20px] font-bold tracking-[-0.5px]">{monthLabel}</h2>
                <div className="flex gap-1">
                  <button onClick={prev} aria-label="Previous month" className="w-10 h-10 sm:w-[30px] sm:h-[30px] rounded-[8px] border border-border-strong inline-flex items-center justify-center hover:bg-sunken cursor-pointer transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={neutral.ink2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                  </button>
                  <button onClick={next} aria-label="Next month" className="w-10 h-10 sm:w-[30px] sm:h-[30px] rounded-[8px] border border-border-strong inline-flex items-center justify-center hover:bg-sunken cursor-pointer transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={neutral.ink2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                  </button>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })}>
                  Today
                </Button>
              </div>
              <div className="flex items-center gap-3.5 text-[11px] text-ink-3">
                <span className="flex items-center gap-1.5"><Dot color={statusTokens.red.dot} size={8} /> Overdue</span>
                <span className="flex items-center gap-1.5"><Dot color={brand[700]} size={8} /> Due</span>
                <span className="flex items-center gap-1.5"><Dot color={statusTokens.green.dot} size={8} /> Done</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
                <div key={w} className="label-mono text-center text-ink-3 pb-1">{w}</div>
              ))}
              {cells.map((c, i) => {
                const extra = c.tasks.length - 2;
                return (
                  <div
                    key={i}
                    role={c.inMonth ? 'button' : undefined}
                    tabIndex={c.inMonth ? 0 : undefined}
                    title={c.inMonth ? 'Add a task on this day' : undefined}
                    onClick={() => c.k && pickDay(c.k)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && c.k && (e.preventDefault(), pickDay(c.k))}
                    className={`min-h-[72px] sm:min-h-[96px] rounded-[10px] p-[4px] sm:p-[7px] flex flex-col gap-1 border transition-colors ${c.inMonth ? 'cursor-pointer hover:border-border-strong' : ''}`}
                    style={{
                      borderColor: c.isToday ? brand[700] : c.inMonth ? 'rgb(var(--border-soft, 238 237 231))' : 'transparent',
                      background: c.inMonth ? (c.isToday ? 'rgb(var(--tint-green-soft, 243 248 245))' : neutral.surface) : neutral.sunken,
                      boxShadow: c.isToday ? `0 0 0 1px ${brand[700]}` : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="fig text-[12px] font-semibold" style={{ color: c.inMonth ? (c.isToday ? brand[700] : neutral.ink) : neutral.crumb }}>
                        {c.inMonth ? c.dayNum : ''}
                      </span>
                      {c.isToday && (
                        <span className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-white fig text-[10px] font-semibold" style={{ background: brand[700] }}>·</span>
                      )}
                    </div>
                    {c.tasks.slice(0, 2).map((t) => {
                      const over = isOverdue(t);
                      const bg = t.done ? neutral.tintSuccess2 : over ? statusTokens.red.bg : neutral.tintSuccess;
                      const color = t.done ? statusTokens.green.text : over ? statusTokens.red.text : brand[700];
                      const dot = t.done ? statusTokens.green.dot : over ? statusTokens.red.dot : (FLAT[t.assignee] ?? brand[500]);
                      return (
                        <button
                          key={t.id}
                          title={`${t.title} — ${t.deal.name} (${t.done ? 'click to reopen' : 'click to complete'})`}
                          disabled={toggleTask.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTask.mutate(t.id);
                          }}
                          className="flex items-center gap-[5px] px-1.5 py-[3px] rounded-[6px] text-left cursor-pointer transition-colors disabled:opacity-60"
                          style={{ background: bg }}
                        >
                          <Dot color={dot} size={5} />
                          <span className="min-w-0 text-[10px] font-medium whitespace-nowrap overflow-hidden text-ellipsis" style={{ color, textDecoration: t.done ? 'line-through' : 'none' }}>
                            {t.title}
                          </span>
                        </button>
                      );
                    })}
                    {extra > 0 && <div className="fig text-[9.5px] text-ink-3 pl-0.5">+{extra} more</div>}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* ===== Task panel ===== */}
          <aside className="flex flex-col gap-4">
            {/* stats */}
            <div className="flex gap-3 flex-wrap lg:flex-nowrap">
              <StatCard label="Open tasks" value={groups.stats.open} />
              <StatCard label="Overdue" value={groups.stats.overdue} tone={groups.stats.overdue > 0 ? statusTokens.red.text : undefined} />
              <StatCard label="Done" value={groups.stats.done} tone={statusTokens.green.text} />
            </div>

            {/* add task */}
            <Panel className="!p-4">
              <input
                ref={titleRef}
                type="text"
                placeholder="Add a task…"
                aria-label="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="w-full"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <select className="flex-1 min-w-0 h-[34px] py-0 text-[12px]" aria-label="Deal" value={dealSel} onChange={(e) => setDealId(e.target.value)}>
                  {deals.length === 0 && <option value="">No deals yet</option>}
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <select className="flex-1 min-w-0 h-[34px] py-0 text-[12px]" aria-label="Aspect" value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  {ASPECTS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <input type="date" aria-label="Due date" className="h-[34px] py-0 fig text-[12px] shrink-0" value={due} onChange={(e) => setDue(e.target.value)} />
                <div className="flex gap-1">
                  {PEOPLE.map((p) => (
                    <button
                      key={p.initials}
                      title={p.name}
                      aria-label={`Assign to ${p.name}`}
                      aria-pressed={assignee === p.initials}
                      onClick={() => setAssignee(p.initials)}
                      className="rounded-full shrink-0 cursor-pointer"
                      style={{ outline: assignee === p.initials ? `2px solid ${brand[700]}` : 'none', outlineOffset: 1 }}
                    >
                      <Avatar initials={p.initials} size={26} />
                    </button>
                  ))}
                </div>
                <Button className="ml-auto !h-[34px] !px-4" loading={createTask.isPending} disabled={!title.trim() || !dealSel} onClick={submit}>
                  {!createTask.isPending && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
                  )}
                  Add
                </Button>
              </div>
            </Panel>

            {/* task groups */}
            <Panel className="!p-1.5 max-h-[560px] overflow-y-auto">
              {groups.list.map((g) =>
                g.tasks.length === 0 ? null : (
                  <div key={g.label}>
                    <div className="px-3.5 pt-3 pb-1.5 flex items-center gap-2">
                      <span className="label-mono font-semibold" style={{ color: g.color, letterSpacing: '0.5px' }}>{g.label}</span>
                      <span className="fig text-[10px] font-semibold text-ink-3b">{g.tasks.length}</span>
                    </div>
                    {g.tasks.map((t) => {
                      const over = isOverdue(t);
                      const person = PEOPLE.find((p) => p.initials === t.assignee);
                      return (
                        <div key={t.id} className="flex items-start gap-[11px] px-3.5 py-2.5 rounded-[11px] hover:bg-sunken transition-colors">
                          <button
                            aria-label={t.done ? 'Reopen task' : 'Complete task'}
                            disabled={toggleTask.isPending}
                            onClick={() => toggleTask.mutate(t.id)}
                            className="shrink-0 mt-[1px] w-5 h-5 rounded-[6px] border-2 inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-60"
                            style={{ borderColor: t.done ? brand[700] : 'rgb(var(--checkbox-border, 210 209 202))', background: t.done ? brand[700] : neutral.surface }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: t.done ? 1 : 0 }} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-medium" style={{ color: t.done ? neutral.ink3b : neutral.ink, textDecoration: t.done ? 'line-through' : 'none' }}>
                              {t.title}
                            </div>
                            <div className="mt-[3px] flex items-center gap-[7px] flex-wrap">
                              <span className="text-[11px] text-ink-3">{t.deal.name}</span>
                              <span className="fig px-[7px] py-[2px] rounded-[5px] text-[9px] font-semibold" style={{ background: neutral.sunken2, color: neutral.ink2b, letterSpacing: '0.3px' }}>
                                {t.aspect}
                              </span>
                              <span className="fig text-[11px] font-medium" style={{ color: over ? statusTokens.red.text : neutral.ink2b }}>
                                {t.due ? fmtDue(t.due) : '—'}
                              </span>
                            </div>
                          </div>
                          <span title={person?.name ?? t.assignee}><Avatar initials={t.assignee} size={26} /></span>
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
              {tasks.length === 0 && (
                <div className="py-10 px-5 text-center text-[13px] text-ink-3b">No tasks for this filter.</div>
              )}
            </Panel>

            {/* deal milestones */}
            <Panel title="Deal milestones" right={<span className="fig text-[11px] text-ink-3">{milestones.length}</span>}>
              {milestones.length === 0 ? (
                <EmptyState>No upcoming deal milestones.</EmptyState>
              ) : (
                <div className="flex flex-col gap-2">
                  {milestones.map((d) => (
                    <div key={d.id} className="flex items-center gap-2.5">
                      <Dot color={STAGE_ACCENT[d.stage] ?? neutral.ink3} />
                      <span className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{d.name}</span>
                      <span className="fig text-[11px] font-semibold shrink-0" style={{ color: brand[700] }}>{d.nextMilestone}</span>
                      {d.owner && <Avatar initials={d.owner.initials} size={20} />}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
