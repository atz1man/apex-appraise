import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { trpc, getPrincipal } from '../lib/trpc';
import { fM, formatMoneyFull, n0 } from '../lib/format';
import { Button, Spinner, TopBar } from '../components/ui';

type Room = { name: string; condition: number; photos: number; notes: string };
type Weights = { salesComparison: number; cost: number; income: number };
type Screen = 'appraisals' | 'detail' | 'inspection' | 'comps' | 'valuation' | 'sent';

/** Room list per the prototype's inspection screen. */
const DEFAULT_ROOM_NAMES = ['Exterior', 'Living areas', 'Kitchen', 'Bathrooms', 'Basement'];
const defaultRooms = (): Room[] => DEFAULT_ROOM_NAMES.map((name) => ({ name, condition: 0, photos: 0, notes: '' }));
const DEFAULT_WEIGHTS: Weights = { salesComparison: 60, cost: 20, income: 20 };

/** Photo-placeholder gradients from the design handoff. */
const THUMBS = [
  'linear-gradient(150deg,#aebdb2,#7d8f86)',
  'linear-gradient(150deg,#c4cdd2,#9aa6ad)',
  'linear-gradient(150deg,#cdbfae,#a59079)',
];

/** Unified native-feel press feedback for the phone UI's ad-hoc buttons (44px touch targets kept in markup). */
const PRESS = 'transition-all duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100';

const PIN_POS = [
  { top: 50, left: 96 },
  { top: 118, left: 238 },
  { top: 122, left: 118 },
  { top: 60, left: 286 },
];

// ---------- in-frame chrome ----------

function StatusBar({ light = false }: { light?: boolean }) {
  // real phones have a real status bar — the simulated one is desktop-demo chrome
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches) {
    return <div className="flex-none h-2" />;
  }
  return (
    <div className={`flex-none z-20 h-[50px] flex items-center justify-between px-[26px] pt-[15px] pb-2 ${light ? 'text-white' : 'text-ink'}`}>
      <div className="text-[16px] font-semibold tracking-[-0.2px]">9:41</div>
      <div className="flex items-center gap-[7px]">
        <svg aria-hidden="true" width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" opacity="0.35" /></svg>
        <svg aria-hidden="true" width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 2C11.3 2 13.9 3.1 15.8 4.9L17 3.6C14.8 1.4 11.8 0 8.5 0S2.2 1.4 0 3.6L1.2 4.9C3.1 3.1 5.7 2 8.5 2Z" /><path d="M8.5 6C9.9 6 11.2 6.6 12.2 7.5L13.4 6.2C12 4.9 10.3 4 8.5 4S5 4.9 3.6 6.2L4.8 7.5C5.8 6.6 7.1 6 8.5 6Z" /><circle cx="8.5" cy="10" r="1.8" /></svg>
        <svg aria-hidden="true" width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="17" height="9" rx="2" fill="currentColor" /><path d="M24.5 4.5V8.5C25.5 8.2 26 7.4 26 6.5S25.5 4.8 24.5 4.5Z" fill="currentColor" /></svg>
      </div>
    </div>
  );
}

function HomeBar() {
  return (
    <div className="h-6 flex items-center justify-center">
      <div className="w-[140px] h-[5px] rounded-[3px] bg-ink" />
    </div>
  );
}

function BackBtn({ onClick, light = false }: { onClick: () => void; light?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label="Back"
      className={`w-11 h-11 -ml-2 flex items-center justify-center rounded-full ${PRESS} ${light ? 'bg-white/25 text-white' : 'text-ink'}`}
      style={light ? { backdropFilter: 'blur(8px)' } : undefined}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg>
    </button>
  );
}

const TAB_ICONS: Record<string, ReactNode> = {
  appraisals: <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 3.6h6a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z" /><path d="M9 11.5h6M9 15h4" /></svg>,
  inspection: <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1 1 0 0 1 9.6 4h4.8a1 1 0 0 1 .8.4l1 1.6h1.3A2.5 2.5 0 0 1 20 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5Z" /><circle cx="12" cy="12.4" r="3.1" /></svg>,
  comps: <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M5 20v-7M12 20V5M19 20v-9" /></svg>,
  valuation: <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.6h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z" /><path d="M13.5 3.6V8h4.4" /><path d="M9 13h6M9 16.5h6" /></svg>,
};

function TabBar({ active, onGo }: { active: Screen; onGo: (s: Screen) => void }) {
  const tabs: Array<[Screen, string]> = [
    ['appraisals', 'Appraisals'],
    ['inspection', 'Inspect'],
    ['comps', 'Comps'],
    ['valuation', 'Valuation'],
  ];
  return (
    <div className="flex-none bg-surface/95 border-t border-border-std px-3.5 pt-2.5" style={{ backdropFilter: 'blur(18px)' }}>
      <div className="flex">
        {tabs.map(([key, label]) => {
          const on = active === key;
          return (
            <button key={key} onClick={() => onGo(key)} className={`flex-1 min-h-[44px] flex flex-col items-center gap-1 ${PRESS}`} style={{ color: on ? '#14503B' : '#9AA09A' }}>
              {TAB_ICONS[key]}
              <span className="text-[10px]" style={{ fontWeight: on ? 600 : 500 }}>{label}</span>
            </button>
          );
        })}
      </div>
      <HomeBar />
    </div>
  );
}

function CtaBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex-none bg-surface/95 border-t border-border-std px-[18px] pt-3" style={{ backdropFilter: 'blur(18px)' }}>
      {children}
      <HomeBar />
    </div>
  );
}

const CHECK = <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>;
const STAR = <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 7.2L22 9.6l-5.8 4.6L18 22l-6-4.2L6 22l1.8-7.8L2 9.6l7.4-.4L12 2Z" /></svg>;
const ARROW = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

const netAdjFmt = (pts: number) => (pts === 0 ? '—' : `${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)}%`);
const netAdjColor = (pts: number) => (pts > 0 ? '#1E7A55' : pts < 0 ? '#B23A2E' : '#9AA09A');

// ---------- main ----------

export default function FieldApp() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const utils = trpc.useUtils();
  const { data: dealsData, isLoading: dealsLoading } = trpc.deals.list.useQuery({});
  const deals = dealsData?.deals ?? [];

  const [screen, setScreen] = useState<Screen>('appraisals');
  const [dealId, setDealId] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!dealId && deals.length) setDealId(deals[0].id);
  }, [deals, dealId]);

  // one lightweight status query per deal — powers the dashboard chips
  const inspQueries = trpc.useQueries((t) => deals.map((d) => t.inspections.get(d.id)));

  const deal = deals.find((d) => d.id === dealId);
  const { data: inspection } = trpc.inspections.get.useQuery(dealId, { enabled: !!dealId });
  const { data: compsData } = trpc.comparables.list.useQuery(dealId, { enabled: !!dealId });
  const { data: appraisal } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });

  // ---- per-deal local inspection state (hydrated from the saved inspection) ----
  const [rooms, setRooms] = useState<Room[]>(defaultRooms());
  const [current, setCurrent] = useState(0);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [value, setValue] = useState<number | null>(null);
  const [hydratedFor, setHydratedFor] = useState('');

  useEffect(() => {
    if (!dealId || inspection === undefined || hydratedFor === dealId) return;
    if (inspection) {
      setRooms(inspection.rooms.length ? inspection.rooms : defaultRooms());
      setWeights(inspection.approachWeights);
      setValue(inspection.reconciledValue);
    } else {
      setRooms(defaultRooms());
      setWeights(DEFAULT_WEIGHTS);
      setValue(null);
    }
    setCurrent(0);
    setHydratedFor(dealId);
  }, [dealId, inspection, hydratedFor]);

  const rated = rooms.filter((r) => r.condition > 0).length;
  const photoTotal = rooms.reduce((a, r) => a + r.photos, 0);
  const pct = rooms.length ? (rated / rooms.length) * 100 : 0;

  const nia = appraisal?.result.nia ?? 0;
  const comps = compsData?.comps ?? [];
  const summary = compsData?.summary;
  const supported = summary?.supportedPsf ?? 0;
  const indicated = Math.round(supported * nia);

  // default the reconciled value when the valuation screen opens
  useEffect(() => {
    if (screen !== 'valuation' || value != null) return;
    const v = indicated > 0 ? indicated : Math.round(deal?.gdv ?? 0);
    if (v > 0) setValue(v);
  }, [screen, value, indicated, deal]);

  const save = trpc.inspections.save.useMutation({ onSuccess: () => utils.inspections.get.invalidate() });

  const setRoom = (i: number, patch: Partial<Room>) => setRooms((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const snap = () => setRoom(current, { photos: rooms[current].photos + 1 });

  const saveDraft = () =>
    save.mutate({ id: inspection?.id, dealId, rooms, reconciledValue: value, approachWeights: weights, status: 'draft' });
  const sendToWorkbench = () =>
    save.mutate(
      { id: inspection?.id, dealId, rooms, reconciledValue: value, approachWeights: weights, status: 'submitted' },
      { onSuccess: () => setScreen('sent') },
    );

  const go = (s: Screen) => {
    if (s !== 'appraisals' && !dealId) return;
    setScreen(s);
  };

  const principal = getPrincipal();
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const wSum = weights.salesComparison + weights.cost + weights.income || 1;

  const conf =
    !summary || comps.length === 0
      ? { label: 'No evidence', color: '#6E7269', bg: '#F0EFE9', dot: '#9AA09A' }
      : summary.avgGrossAdjustment < 8
        ? { label: 'High', color: '#1E7A55', bg: '#E4F1EA', dot: '#1E7A55' }
        : summary.avgGrossAdjustment < 15
          ? { label: 'Medium', color: '#9A6212', bg: '#F6ECD9', dot: '#C7A95B' }
          : { label: 'Low', color: '#B23A2E', bg: '#F7E5E2', dot: '#B23A2E' };

  const filtered = deals.filter(
    (d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || d.address.toLowerCase().includes(q.toLowerCase()),
  );
  const nextUnrated = rooms.findIndex((r, i) => r.condition === 0 && i !== current);

  const readiness: Array<[string, boolean]> = [
    [`Areas rated · ${rated} / ${rooms.length}`, rated === rooms.length && rooms.length > 0],
    [`Photos · ${photoTotal}`, photoTotal > 0],
    [`Comparables · ${comps.length}`, comps.length >= 3],
    ['Reconciled value set', (value ?? 0) > 0],
  ];
  const readyPct = Math.round((readiness.filter(([, ok]) => ok).length / readiness.length) * 100);

  // ---------- screens ----------

  const appraisalsScreen = (
    <>
      <StatusBar />
      <div className="flex-1 overflow-y-auto pb-3.5">
        <div className="px-[22px] pt-1.5 flex justify-between items-start">
          <div>
            <div className="label-mono text-ink-3 font-medium tracking-[0.6px]">{today}</div>
            <h1 className="mt-[3px] text-[27px] font-bold tracking-[-0.6px] leading-tight">Appraisals</h1>
            <div className="mt-0.5 text-[13px] text-ink-2">Good morning, {principal?.name?.split(' ')[0] ?? 'surveyor'}</div>
          </div>
          <div className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-white text-[14px] font-semibold" style={{ background: 'linear-gradient(135deg,#1E7A55,#14503B)' }}>
            {principal?.initials ?? 'AO'}
          </div>
        </div>

        {/* search */}
        <div className="mx-[22px] mt-4 flex items-center gap-2.5 bg-surface border border-border-std rounded-[14px] px-3.5 min-h-[44px]">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA09A" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search address or scheme"
            placeholder="Search address or scheme"
            className="flex-1 !border-0 !bg-transparent !p-0 text-[14px] !shadow-none"
            style={{ boxShadow: 'none' }}
          />
        </div>

        {/* insight banner */}
        {indicated > 0 && deal && (
          <div className="mx-[22px] mt-3.5 flex gap-[11px] items-start bg-tint-success border border-[#D6E6DD] rounded-[14px] p-3">
            <div className="flex-none w-[26px] h-[26px] rounded-[8px] bg-brand-700 flex items-center justify-center">
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" /><path d="M19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13Z" /></svg>
            </div>
            <div className="text-[12.5px] leading-[1.45]" style={{ color: '#1E5C45' }}>
              Comparable evidence supports <b className="font-semibold fig">{fM(indicated)}</b> for {deal.name}.
            </div>
          </div>
        )}

        {/* stats */}
        <div className="flex gap-2.5 mx-[22px] mt-3.5">
          {(
            [
              ['Active files', deals.length, '#16201B'],
              ['In progress', inspQueries.filter((iq) => iq.data && iq.data.status !== 'submitted').length, '#9A6212'],
              ['Submitted', inspQueries.filter((iq) => iq.data?.status === 'submitted').length, '#1E7A55'],
            ] as Array<[string, number, string]>
          ).map(([label, v, tone]) => (
            <div key={label} className="flex-1 bg-surface border border-border-std rounded-card px-3 py-[13px]">
              <div className="fig text-[22px] font-semibold tracking-[-1px]" style={{ color: tone }}>{v}</div>
              <div className="mt-0.5 text-[11px] text-ink-2b">{label}</div>
            </div>
          ))}
        </div>

        {/* job cards */}
        <div className="mx-[22px] mt-4 flex flex-col gap-2.5">
          {dealsLoading && <div className="py-10 flex justify-center"><Spinner /></div>}
          {!dealsLoading && filtered.length === 0 && (
            <div className="border border-dashed border-[#DAD9D2] rounded-[13px] py-8 px-4 text-center text-[12.5px] text-ink-3b">
              No appraisal jobs{q ? ' match your search' : ' assigned yet'}.
            </div>
          )}
          {filtered.map((d) => {
            const i = deals.findIndex((x) => x.id === d.id);
            const insp = inspQueries[i]?.data;
            const chip =
              insp?.status === 'submitted'
                ? { t: 'SUBMITTED', c: '#1E7A55', bg: '#E4F1EA' }
                : insp
                  ? { t: 'IN PROGRESS', c: '#9A6212', bg: '#F6ECD9' }
                  : { t: 'TO INSPECT', c: '#6E7269', bg: '#F0EFE9' };
            const rms = insp?.rooms ?? [];
            const p = rms.length ? (rms.filter((r) => r.condition > 0).length / rms.length) * 100 : 0;
            const barColor = insp?.status === 'submitted' ? '#1E7A55' : p > 0 ? '#14503B' : '#ECEBE5';
            return (
              <button
                key={d.id}
                onClick={() => { setDealId(d.id); setScreen('detail'); }}
                className={`bg-surface border border-border-std rounded-[18px] p-3 flex gap-3 text-left w-full cursor-pointer hover:bg-sunken ${PRESS}`}
              >
                <div className="flex-none w-[74px] h-[74px] rounded-[13px]" style={{ background: THUMBS[i % THUMBS.length] }} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <div className="text-[15px] font-semibold tracking-[-0.2px] truncate">{d.name}</div>
                    <span className="flex-none label-mono px-[9px] py-1 rounded-[8px]" style={{ color: chip.c, background: chip.bg }}>{chip.t}</span>
                  </div>
                  <div className="mt-[3px] text-[11.5px] text-ink-3 truncate">{d.address} · {d.assetType.replace('_', '-').toLowerCase()}</div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-[3px] bg-border-std overflow-hidden">
                      <div className="h-full rounded-[3px]" style={{ width: `${p}%`, background: barColor }} />
                    </div>
                    <span className="fig text-[11px] font-medium text-ink-2">{Math.round(p)}%</span>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-[11px] text-ink-2b">{d.stage.replace('_', ' / ').toLowerCase()}</span>
                    <span className="fig text-[12.5px] font-semibold">{formatMoneyFull(d.gdv)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <TabBar active="appraisals" onGo={go} />
    </>
  );

  const detailScreen = deal && (
    <>
      <div className="flex-1 overflow-y-auto">
        {/* hero */}
        <div className="relative h-[248px]" style={{ background: 'linear-gradient(165deg,#b9c6bd 0%,#8fa195 55%,#6d7e74 100%)' }}>
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(10,20,15,0.28) 0%,rgba(10,20,15,0) 32%,rgba(10,20,15,0) 52%,rgba(10,20,15,0.55) 100%)' }} />
          <div className="absolute top-[54px] left-[18px] right-[18px] flex justify-between">
            <BackBtn light onClick={() => setScreen('appraisals')} />
          </div>
          <div className="absolute left-5 bottom-[18px] right-5">
            <span className="inline-flex px-[9px] py-1 rounded-[7px] bg-white/85 label-mono" style={{ color: '#14503B' }}>
              FILE #{deal.id.slice(-6).toUpperCase()}
            </span>
            <div className="mt-2 text-[22px] font-bold tracking-[-0.5px] text-white">{deal.name}</div>
            <div className="text-[13px] text-white/85">{deal.address}</div>
          </div>
        </div>

        {/* key facts */}
        <div className="flex bg-surface border-b border-border-std py-[15px] px-1.5">
          {(
            [
              [nia > 0 ? n0(nia) : '—', 'NIA ft²'],
              [appraisal ? n0(appraisal.input.units.reduce((a, u) => a + u.count, 0)) : '—', 'Units'],
              [`${Math.round(deal.roc * 100)}%`, 'RoC'],
              [`${deal.probability}%`, 'Prob.'],
            ] as Array<[string, string]>
          ).map(([v, label]) => (
            <div key={label} className="flex-1 text-center border-r border-border-std last:border-r-0">
              <div className="fig text-[16px] font-semibold">{v}</div>
              <div className="mt-0.5 text-[10px] text-ink-3">{label}</div>
            </div>
          ))}
        </div>

        {/* valuation summary */}
        <div className="mx-[18px] mt-4 bg-surface border border-border-std rounded-[18px] p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="label-mono text-ink-3">Estimated value</div>
              <div className="fig mt-[5px] text-[30px] font-semibold tracking-[-1.5px]">{formatMoneyFull(deal.gdv)}</div>
            </div>
            <span className="flex items-center gap-[5px] px-[9px] py-[5px] rounded-[9px]" style={{ background: conf.bg }}>
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: conf.dot }} />
              <span className="text-[11px] font-semibold" style={{ color: conf.color }}>{conf.label}</span>
            </span>
          </div>
          {summary && comps.length > 0 && nia > 0 && (
            <div className="mt-3.5">
              <div className="relative h-1.5 rounded-[3px] bg-border-std">
                <div className="absolute top-0 bottom-0 rounded-[3px]" style={{ left: '18%', right: '24%', background: 'linear-gradient(90deg,#1E7A55,#14503B)' }} />
                <div className="absolute left-1/2 -translate-x-1/2 -top-[3px] w-3 h-3 rounded-full bg-brand-700 border-2 border-surface" />
              </div>
              <div className="mt-2 flex justify-between fig text-[11px] font-medium text-ink-2b">
                <span>{formatMoneyFull(Math.round(summary.range.lo * nia))}</span>
                <span>{formatMoneyFull(Math.round(summary.range.hi * nia))}</span>
              </div>
            </div>
          )}
        </div>

        {/* detail rows */}
        <div className="mx-5 mt-3 mb-[18px]">
          {(
            [
              ['Asset type', deal.assetType.replace('_', '-').toLowerCase()],
              ['Stage', deal.stage.replace('_', ' / ').toLowerCase()],
              ['Figures', deal.figureStatus.toLowerCase()],
              ['Next milestone', deal.nextMilestone ?? '—'],
              ['Owner', deal.owner?.name ?? '—'],
            ] as Array<[string, string]>
          ).map(([k, v], i, arr) => (
            <div key={k} className={`flex justify-between py-[13px] ${i < arr.length - 1 ? 'border-b border-border-faint' : ''}`}>
              <span className="text-[13px] text-ink-2b">{k}</span>
              <span className="text-[13px] font-medium capitalize">{v}</span>
            </div>
          ))}
        </div>
      </div>
      <CtaBar>
        <div className="flex gap-2.5">
          <button
            onClick={() => setScreen('inspection')}
            className={`flex-1 flex items-center justify-center gap-2 h-[52px] rounded-[15px] bg-brand-700 text-white text-[15px] font-semibold ${PRESS}`}
          >
            {inspection?.status === 'submitted' ? 'Review inspection' : rated > 0 ? 'Continue inspection' : 'Start inspection'} {ARROW}
          </button>
          <button
            onClick={() => setScreen('comps')}
            aria-label="Comparable sales"
            className={`flex-none w-[52px] h-[52px] rounded-[15px] border border-border-strong bg-surface flex items-center justify-center text-brand-700 ${PRESS}`}
          >
            {TAB_ICONS.comps}
          </button>
        </div>
      </CtaBar>
    </>
  );

  const inspectionScreen = deal && (
    <>
      <StatusBar />
      <div className="flex-none px-[22px] pt-1.5 pb-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <BackBtn onClick={() => setScreen('detail')} />
            <div>
              <div className="text-[19px] font-bold tracking-[-0.4px]">Inspection</div>
              <div className="text-[11.5px] text-ink-3">{deal.name}</div>
            </div>
          </div>
          <button onClick={saveDraft} disabled={save.isPending} className={`min-h-[44px] px-2 rounded-[10px] text-[13px] font-semibold text-brand-700 disabled:opacity-50 disabled:active:scale-100 ${PRESS}`}>
            {save.isPending ? <Spinner /> : 'Save'}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <div className="flex-1 h-[7px] rounded-[4px] bg-border-std overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#1E7A55,#14503B)' }} />
          </div>
          <span className="fig text-[11.5px] font-medium text-ink-2">{rated} / {rooms.length} areas</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[22px] pb-4">
        {/* camera viewfinder */}
        <div className="relative h-[188px] rounded-[18px] overflow-hidden" style={{ background: 'linear-gradient(160deg,#8a978f,#56635b)' }}>
          {[
            { top: 12, left: 12, borderTop: '2.5px solid rgba(255,255,255,0.85)', borderLeft: '2.5px solid rgba(255,255,255,0.85)', borderRadius: '3px 0 0 0' },
            { top: 12, right: 12, borderTop: '2.5px solid rgba(255,255,255,0.85)', borderRight: '2.5px solid rgba(255,255,255,0.85)', borderRadius: '0 3px 0 0' },
            { bottom: 60, left: 12, borderBottom: '2.5px solid rgba(255,255,255,0.85)', borderLeft: '2.5px solid rgba(255,255,255,0.85)', borderRadius: '0 0 0 3px' },
            { bottom: 60, right: 12, borderBottom: '2.5px solid rgba(255,255,255,0.85)', borderRight: '2.5px solid rgba(255,255,255,0.85)', borderRadius: '0 0 3px 0' },
          ].map((s, i) => (
            <div key={i} className="absolute w-5 h-5" style={s} />
          ))}
          <div className="absolute top-3.5 left-1/2 -translate-x-1/2 px-[11px] py-1 rounded-[8px] label-mono text-white" style={{ background: 'rgba(12,18,14,0.5)', backdropFilter: 'blur(6px)' }}>
            CAPTURING · {rooms[current]?.name.toUpperCase()}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[54px] flex items-center justify-center gap-[26px]" style={{ background: 'rgba(12,18,14,0.42)', backdropFilter: 'blur(10px)' }}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 9 4-2v10l-4-2" /></svg>
            <button
              onClick={snap}
              aria-label="Take photo"
              className={`w-11 h-11 rounded-full bg-surface ${PRESS}`}
              style={{ border: '3px solid rgba(255,255,255,0.55)', boxShadow: '0 0 0 2px rgba(12,18,14,0.42)' }}
            />
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /></svg>
          </div>
        </div>

        {/* current area card */}
        {rooms[current] && (
          <div className="mt-4 bg-surface border border-border-std rounded-[18px] p-[15px]">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold">{rooms[current].name}</div>
              {rooms[current].condition > 0 ? (
                <span className="label-mono px-2.5 py-1 rounded-[8px] bg-tint-success-2 text-status-green">C{rooms[current].condition}</span>
              ) : (
                <span className="label-mono px-2.5 py-1 rounded-[8px] bg-sunken-2 text-ink-2b">UNRATED</span>
              )}
            </div>
            <div className="mt-3">
              <div className="label-mono text-ink-3">Condition</div>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = rooms[current].condition >= n;
                  return (
                    <button
                      key={n}
                      onClick={() => setRoom(current, { condition: n })}
                      aria-label={`Condition ${n}`}
                      className={`w-11 h-11 flex items-center justify-center rounded-full ${PRESS}`}
                    >
                      <span
                        className="w-[22px] h-[22px] rounded-full transition-all"
                        style={{ background: on ? '#14503B' : '#fff', border: on ? 'none' : '2px solid #DAD9D2' }}
                      />
                    </button>
                  );
                })}
                <span className="ml-auto self-center text-[11px] text-ink-3">1 poor — 5 excellent</span>
              </div>
            </div>
            {/* photo thumbs */}
            <div className="mt-3 flex gap-2">
              {Array.from({ length: Math.min(rooms[current].photos, 3) }).map((_, i) => (
                <div key={i} className="flex-1 aspect-square rounded-[11px]" style={{ background: THUMBS[i % THUMBS.length] }} />
              ))}
              <button onClick={snap} aria-label="Add photo" className={`flex-1 aspect-square rounded-[11px] flex items-center justify-center ${PRESS}`} style={{ border: '1.5px dashed #D2D1CA', maxWidth: 78 }}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14503B" strokeWidth="2" strokeLinecap="round"><path d="M12 6v12M6 12h12" /></svg>
              </button>
              <span className="fig self-center text-[11px] text-ink-2 whitespace-nowrap">{rooms[current].photos} photos</span>
            </div>
            <input
              className="mt-3 w-full text-[12.5px]"
              aria-label={`Notes for ${rooms[current].name}`}
              placeholder="Notes — condition, defects, finishes…"
              value={rooms[current].notes}
              onChange={(e) => setRoom(current, { notes: e.target.value })}
            />
          </div>
        )}

        {/* area checklist */}
        <div className="mt-3.5 flex flex-col gap-[9px]">
          {rooms.map((r, i) => (
            <button
              key={r.name}
              onClick={() => setCurrent(i)}
              className={`flex items-center gap-[11px] bg-surface rounded-[13px] px-[15px] py-[13px] min-h-[48px] text-left cursor-pointer hover:bg-sunken ${PRESS}`}
              style={{ border: i === current ? '1.5px solid #14503B' : '1px solid #ECEBE5' }}
            >
              {r.condition > 0 ? (
                <span className="flex-none w-5 h-5 rounded-[6px] bg-tint-success-2 flex items-center justify-center text-status-green">{CHECK}</span>
              ) : (
                <span className="flex-none w-5 h-5 rounded-[6px]" style={{ border: '2px solid #DAD9D2' }} />
              )}
              <span className={`flex-1 text-[13.5px] font-medium ${r.condition > 0 ? 'text-ink' : 'text-ink-2b'}`}>{r.name}</span>
              <span className="fig text-[11px] font-medium" style={{ color: r.condition > 0 ? '#1E7A55' : '#C0BFB8' }}>
                {r.photos} ph · {r.condition > 0 ? `C${r.condition}` : 'C—'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <CtaBar>
        {nextUnrated >= 0 ? (
          <button onClick={() => setCurrent(nextUnrated)} className={`w-full flex items-center justify-center gap-2 h-[52px] rounded-[15px] bg-brand-700 text-white text-[15px] font-semibold ${PRESS}`}>
            Next area: {rooms[nextUnrated].name} {ARROW}
          </button>
        ) : (
          <button onClick={() => setScreen('valuation')} className={`w-full flex items-center justify-center gap-2 h-[52px] rounded-[15px] bg-brand-700 text-white text-[15px] font-semibold ${PRESS}`}>
            Review valuation {ARROW}
          </button>
        )}
      </CtaBar>
    </>
  );

  const compsScreen = deal && (
    <>
      <StatusBar />
      <div className="flex-none px-[22px] pt-1.5 pb-3 flex items-center gap-1">
        <BackBtn onClick={() => setScreen('detail')} />
        <div className="text-[19px] font-bold tracking-[-0.4px]">Comparable sales</div>
      </div>
      <div className="flex-1 overflow-y-auto px-[22px] pb-4">
        {/* mini map */}
        <div className="relative h-[174px] rounded-[18px] overflow-hidden" style={{ background: 'linear-gradient(160deg,#e3e9e3,#cdd6d8)' }}>
          <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(120,140,130,0.18) 1px,transparent 1px),linear-gradient(90deg,rgba(120,140,130,0.18) 1px,transparent 1px)', backgroundSize: '34px 34px' }} />
          <div className="absolute left-0 right-0" style={{ top: 42, height: 14, background: 'rgba(150,168,158,0.4)', transform: 'rotate(-8deg)' }} />
          <div className="absolute left-0 right-0" style={{ top: 104, height: 20, background: 'rgba(150,168,158,0.32)', transform: 'rotate(5deg)' }} />
          <div className="absolute" style={{ top: 74, left: 172 }}>
            <div className="w-[30px] h-[30px] rounded-full bg-brand-700 flex items-center justify-center text-white" style={{ border: '3px solid #fff', boxShadow: '0 4px 10px rgba(20,30,25,0.3)' }}>{STAR}</div>
          </div>
          {comps.slice(0, PIN_POS.length).map((c, i) => (
            <div key={c.id} className="absolute w-[18px] h-[18px] rounded-full bg-brand-400" style={{ ...PIN_POS[i], border: '2.5px solid #fff', boxShadow: '0 3px 7px rgba(20,30,25,0.25)' }} />
          ))}
          <div className="absolute bottom-3 left-3 px-2.5 py-[5px] rounded-[8px] fig text-[10px] font-medium bg-white/90 text-brand-700">
            {comps.length} comp{comps.length === 1 ? '' : 's'} · local evidence
          </div>
        </div>

        {/* subject row */}
        <div className="mt-3.5 flex items-center gap-2.5 px-[13px] py-[11px] rounded-[13px] bg-brand-700 text-white">
          {STAR}
          <span className="flex-1 text-[13px] font-medium truncate">Subject — {deal.name}</span>
          {nia > 0 && <span className="fig text-[13px] font-semibold text-white/90">{n0(nia)} sf</span>}
        </div>

        {/* comp cards */}
        {comps.length === 0 && (
          <div className="mt-3 border border-dashed border-[#DAD9D2] rounded-[13px] py-8 px-4 text-center text-[12.5px] text-ink-3b">
            No comparables logged for this scheme yet — add them on the desktop workbench.
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2.5">
          {comps.map((c, i) => {
            const adj = summary?.comps[i];
            return (
              <div key={c.id} className="bg-surface border border-border-std rounded-card p-3.5">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold truncate">{c.address}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3 truncate">{c.meta || 'Comparable sale'}</div>
                  </div>
                  <span className="flex-none w-[22px] h-[22px] rounded-[7px] bg-brand-700 flex items-center justify-center text-white">{CHECK}</span>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="label-mono text-ink-3 font-normal">BASE</div>
                    <div className="fig text-[16px] font-semibold">£{n0(c.basePsf)}<span className="text-[11px] text-ink-3">/ft²</span></div>
                  </div>
                  <div className="text-center">
                    <div className="label-mono text-ink-3 font-normal">NET ADJ</div>
                    <div className="fig text-[13px] font-semibold" style={{ color: netAdjColor(adj?.netAdjustment ?? 0) }}>{netAdjFmt(adj?.netAdjustment ?? 0)}</div>
                  </div>
                  <div className="text-right">
                    <div className="label-mono text-ink-3 font-normal">ADJUSTED</div>
                    <div className="fig text-[16px] font-semibold text-brand-700">£{n0(adj?.adjustedPsf ?? c.basePsf)}<span className="text-[11px] text-ink-3">/ft²</span></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* summary + tab bar */}
      <div className="flex-none bg-surface/95 border-t border-border-std" style={{ backdropFilter: 'blur(18px)' }}>
        <div className="flex items-center justify-between px-[22px] py-3 border-b border-border-faint">
          <span className="text-[12px] text-ink-2b">{comps.length} comps · supported £{n0(supported)}/ft²</span>
          <span className="flex items-baseline gap-[7px]">
            <span className="text-[11px] text-ink-3">Indicated</span>
            <span className="fig text-[16px] font-semibold text-brand-700">{indicated > 0 ? formatMoneyFull(indicated) : '—'}</span>
          </span>
        </div>
        <div className="px-3.5 pt-2.5">
          <div className="flex">
            {(
              [
                ['appraisals', 'Appraisals'],
                ['inspection', 'Inspect'],
                ['comps', 'Comps'],
                ['valuation', 'Valuation'],
              ] as Array<[Screen, string]>
            ).map(([key, label]) => (
              <button key={key} onClick={() => go(key)} className={`flex-1 min-h-[44px] flex flex-col items-center gap-1 ${PRESS}`} style={{ color: key === 'comps' ? '#14503B' : '#9AA09A' }}>
                {TAB_ICONS[key]}
                <span className="text-[10px]" style={{ fontWeight: key === 'comps' ? 600 : 500 }}>{label}</span>
              </button>
            ))}
          </div>
          <HomeBar />
        </div>
      </div>
    </>
  );

  const valuationScreen = deal && (
    <>
      <StatusBar />
      <div className="flex-none px-[22px] pt-1.5 pb-3 flex items-center gap-1">
        <BackBtn onClick={() => setScreen('detail')} />
        <div className="text-[19px] font-bold tracking-[-0.4px]">Valuation</div>
      </div>
      <div className="flex-1 overflow-y-auto px-[22px] pb-4">
        {/* hero value */}
        <div className="relative rounded-[20px] overflow-hidden p-5" style={{ background: 'linear-gradient(155deg,#1B6048 0%,#14503B 60%,#0F4030 100%)' }}>
          <div className="absolute rounded-full" style={{ top: -30, right: -30, width: 140, height: 140, background: 'rgba(255,255,255,0.06)' }} />
          <div className="relative flex justify-between items-center">
            <div className="label-mono font-medium text-white/60">Reconciled value</div>
            <span className="flex items-center gap-[5px] px-[9px] py-1 rounded-[8px] bg-white/15">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#7FE3B4' }} />
              <span className="text-[10px] font-semibold text-white">{conf.label} confidence</span>
            </span>
          </div>
          <div className="relative mt-2 flex items-baseline">
            <span className="fig text-[26px] font-semibold text-white/60">£</span>
            <input
              inputMode="numeric"
              value={value != null ? value.toLocaleString('en-GB') : ''}
              placeholder="0"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '');
                setValue(digits ? parseInt(digits, 10) : null);
              }}
              className="fig flex-1 min-w-0 !bg-transparent !border-0 !p-0 text-[36px] font-semibold tracking-[-2px] !text-white"
              style={{ boxShadow: 'none' }}
              aria-label="Reconciled value"
            />
          </div>
          <div className="relative mt-1 text-[11px] text-white/60">
            Effective date · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          {summary && comps.length > 0 && nia > 0 && (
            <div className="relative mt-4">
              <div className="relative h-1.5 rounded-[3px] bg-white/20">
                <div className="absolute top-0 bottom-0 rounded-[3px] bg-white/55" style={{ left: '16%', right: '22%' }} />
                <div className="absolute -top-[3px] w-3 h-3 rounded-full bg-white" style={{ left: '48%' }} />
              </div>
              <div className="mt-2 flex justify-between fig text-[11px] font-medium text-white/75">
                <span>{fM(Math.round(summary.range.lo * nia))}</span>
                <span>{fM(Math.round(summary.range.hi * nia))}</span>
              </div>
            </div>
          )}
        </div>

        {/* approach weighting */}
        <div className="mt-4 label-mono text-ink-3">Approach weighting</div>
        <div className="mt-2.5 bg-surface border border-border-std rounded-card p-[15px] flex flex-col gap-3.5">
          {(
            [
              ['salesComparison', 'Sales comparison', '#14503B'],
              ['cost', 'Cost approach', '#1E9E6A'],
              ['income', 'Income approach', '#9AA09A'],
            ] as Array<[keyof Weights, string, string]>
          ).map(([key, label, color]) => (
            <div key={key}>
              <div className="flex justify-between items-baseline">
                <span className="text-[13px] font-medium">{label}</span>
                <span className="fig text-[12px] font-semibold text-brand-700">{Math.round((weights[key] / wSum) * 100)}%</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={weights[key]}
                  onChange={(e) => setWeights((w) => ({ ...w, [key]: parseInt(e.target.value, 10) }))}
                  className="flex-1 h-11 !border-0 !bg-transparent !p-0"
                  style={{ accentColor: color, boxShadow: 'none' }}
                  aria-label={`${label} weight`}
                />
                <span className="fig w-8 text-right text-[11px] text-ink-2">{weights[key]}</span>
              </div>
            </div>
          ))}
          <div className="text-[10.5px] text-ink-3 border-t border-border-faint pt-2.5">Weights normalise to 100% across the three approaches.</div>
        </div>

        {/* insight */}
        {comps.length > 0 && summary && (
          <div className="mt-3.5 flex gap-[11px] items-start bg-tint-success border border-[#D6E6DD] rounded-[14px] p-[13px]">
            <div className="flex-none w-[26px] h-[26px] rounded-[8px] bg-brand-700 flex items-center justify-center">
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" /></svg>
            </div>
            <div className="text-[12.5px] leading-[1.45]" style={{ color: '#1E5C45' }}>
              {comps.length} comp{comps.length === 1 ? '' : 's'}, avg gross adjustment {summary.avgGrossAdjustment.toFixed(1)}pts — supports a{' '}
              <b className="font-semibold">{conf.label.toLowerCase()} confidence</b> rating.
            </div>
          </div>
        )}

        {/* report readiness */}
        <div className="mt-3.5 bg-surface border border-border-std rounded-card p-[15px]">
          <div className="flex justify-between items-center">
            <span className="text-[13px] font-semibold">Report readiness</span>
            <span className="fig text-[12px] font-semibold" style={{ color: readyPct === 100 ? '#1E7A55' : '#9A6212' }}>{readyPct}%</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {readiness.map(([label, ok]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-[18px] h-[18px] rounded-[6px] flex items-center justify-center" style={{ background: ok ? '#E4F1EA' : '#F6ECD9' }}>
                  {ok ? (
                    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1E7A55" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                  ) : (
                    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9A6212" strokeWidth="2.4" strokeLinecap="round"><path d="M12 8v5M12 16h.01" /></svg>
                  )}
                </span>
                <span className={`text-[12px] ${ok ? 'text-ink' : 'text-ink-2b'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <CtaBar>
        <button
          onClick={sendToWorkbench}
          disabled={save.isPending || !value}
          className={`w-full flex items-center justify-center gap-2 h-[52px] rounded-[15px] bg-brand-700 text-white text-[15px] font-semibold disabled:opacity-50 disabled:active:scale-100 ${PRESS}`}
        >
          {save.isPending ? (
            <Spinner />
          ) : (
            <>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17V5a2 2 0 0 1 2-2h10M8 21h10a2 2 0 0 0 2-2V9M16 3l4 4-4 4M20 7H9" /></svg>
              Send to workbench
            </>
          )}
        </button>
      </CtaBar>
    </>
  );

  const sentScreen = deal && (
    <>
      <StatusBar />
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-tint-success-2 flex items-center justify-center text-status-green">
          <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
        </div>
        <div className="mt-5 text-[21px] font-bold tracking-[-0.5px]">Sent to workbench</div>
        <div className="mt-1.5 text-[13px] text-ink-2 leading-[1.5]">
          {deal.name} — {value != null ? formatMoneyFull(value) : '—'} reconciled, {rated} of {rooms.length} areas rated, {photoTotal} photos.
        </div>
        <Link
          to={`/deal/${dealId}/workbench`}
          className={`mt-7 w-full flex items-center justify-center gap-2 h-[52px] rounded-[15px] bg-brand-700 text-white text-[15px] font-semibold ${PRESS}`}
        >
          Open valuation workbench {ARROW}
        </Link>
        <button onClick={() => setScreen('appraisals')} className={`mt-2.5 w-full h-[48px] rounded-[15px] text-[14px] font-semibold text-ink-2 hover:bg-sunken ${PRESS}`}>
          Back to appraisals
        </button>
      </div>
      <div className="flex-none">
        <HomeBar />
      </div>
    </>
  );

  const screens = dealsLoading && !deals.length ? (
    <div className="flex-1 flex items-center justify-center"><Spinner /></div>
  ) : (
    <>
      {screen === 'appraisals' && appraisalsScreen}
      {screen === 'detail' && detailScreen}
      {screen === 'inspection' && inspectionScreen}
      {screen === 'comps' && compsScreen}
      {screen === 'valuation' && valuationScreen}
      {screen === 'sent' && sentScreen}
    </>
  );

  // On a real phone (or installed PWA) the field app runs full-bleed — the
  // actual mobile product, with safe-area padding. The desktop keeps the
  // presentation bezel for demos.
  if (isMobile) {
    return (
      <div
        className="fixed inset-0 bg-canvas flex flex-col overflow-hidden"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {screens}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Field app"
        right={
          dealId ? (
            <Button to={`/deal/${dealId}/workbench`} variant="secondary" size="sm">
              Open valuation workbench →
            </Button>
          ) : undefined
        }
      />
      <main className="flex flex-col items-center gap-4 py-10 px-6">
        {/* iOS device frame */}
        <div
          className="flex-none rounded-[54px] p-[11px]"
          style={{ background: 'linear-gradient(160deg,#23231f,#100f0d)', boxShadow: '0 32px 64px -22px rgba(20,30,25,0.5), 0 8px 22px rgba(0,0,0,0.16)' }}
        >
          <div className="relative w-[390px] h-[822px] rounded-[44px] overflow-hidden bg-canvas flex flex-col">
            {/* dynamic island */}
            <div className="absolute top-[11px] left-1/2 -translate-x-1/2 w-[118px] h-[34px] rounded-[20px] z-30" style={{ background: '#0c0c0a' }} />
            {screens}
          </div>
        </div>
        <div className="label-mono text-ink-3 font-medium tracking-[1px]">Field companion app — ships as the native mobile build</div>
      </main>
    </div>
  );
}
