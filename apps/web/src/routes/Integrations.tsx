import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { Button, Dot, EmptyState, Spinner, TopBar } from '../components/ui';

type Status = 'CONNECTED' | 'ATTENTION' | 'NOT_CONNECTED';

interface ProviderMeta {
  provider: string; // DB key
  name: string; // display name (per prototype)
  mark: string;
  desc: string;
}

const GROUPS: Array<{ label: string; items: ProviderMeta[] }> = [
  {
    label: 'Property & market data',
    items: [
      { provider: 'HM Land Registry', name: 'HM Land Registry', mark: 'LR', desc: 'Sold price paid data and title information for comparable evidence and ownership.' },
      { provider: 'EPC Register', name: 'EPC Register', mark: 'EP', desc: 'Energy performance certificates — floor areas and ratings for the subject and comps.' },
      { provider: 'PriceHubble AVM', name: 'PriceHubble AVM', mark: 'PH', desc: 'Automated valuation and market intelligence as a cross-check band on every appraisal.' },
    ],
  },
  {
    label: 'Planning & geospatial',
    items: [
      { provider: 'Planning Portal', name: 'Planning Portal', mark: 'PP', desc: 'Application history, decision notices and conditions pulled by site address.' },
      { provider: 'Ordnance Survey', name: 'Ordnance Survey', mark: 'OS', desc: 'Mapping, site boundaries and area measurement for plans and red-line sites.' },
      { provider: 'Environment Agency', name: 'Environment Agency', mark: 'EA', desc: 'Flood-risk zones and contaminated-land screening for site due diligence.' },
    ],
  },
  {
    label: 'Cost, finance & workflow',
    items: [
      { provider: 'BCIS', name: 'BCIS cost data', mark: 'BC', desc: 'RICS building-cost benchmarks to validate build rates by use and region.' },
      { provider: 'Xero', name: 'Xero', mark: 'XE', desc: 'Push committed costs and drawdowns into accounting for live cost monitoring.' },
      { provider: 'DocuSign', name: 'DocuSign', mark: 'DS', desc: 'Issue reports and term sheets for signature directly from the data room.' },
    ],
  },
];

const STATUS_STYLE: Record<Status, { label: string; dot: string; bg: string; color: string; border: string; iconBg: string; iconColor: string }> = {
  CONNECTED: { label: 'Connected', dot: '#1E7A55', bg: '#E4F1EA', color: '#1E7A55', border: '#BFE0CD', iconBg: '#ECF3EF', iconColor: '#14503B' },
  ATTENTION: { label: 'Attention', dot: '#C7A95B', bg: '#F8F0DE', color: '#9A6212', border: '#F8F0DE', iconBg: '#F8F0DE', iconColor: '#9A6212' },
  NOT_CONNECTED: { label: 'Not connected', dot: '#9AA09A', bg: '#F0EFE9', color: '#8A908A', border: '#E6E5DE', iconBg: '#F3F4F1', iconColor: '#6E7269' },
};

/** relative sync time: 2h ago / 3d ago */
function rel(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Integrations() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.integrations.list.useQuery();
  const connect = trpc.integrations.connect.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });

  const byProvider = new Map((rows ?? []).map((r) => [r.provider, r]));
  const connected = (rows ?? []).filter((r) => r.status === 'CONNECTED').length;
  const total = rows?.length ?? 0;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/" className="text-inactive hover:text-brand-700">Hub</Link>
            {' / '}Data &amp; integrations
          </span>
        }
        right={
          total > 0 && (
            <span className="inline-flex items-center gap-2 rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-700">
              <Dot color="#1E7A55" /> {connected} of {total} connected
            </span>
          )
        }
      />

      <main className="max-w-[1280px] mx-auto px-6 pb-14">
        <div className="mt-6 mb-5">
          <div className="text-[22px] font-bold tracking-[-0.6px]">Connect your data sources</div>
          <div className="mt-1 text-[13.5px] text-ink-3 max-w-[620px] leading-relaxed">
            Live data feeds make extraction trustworthy and appraisals defensible — comparable evidence, planning, EPCs and mapping flow
            straight into every deal.
          </div>
        </div>

        {isLoading ? (
          <div className="mt-12 flex justify-center"><Spinner /></div>
        ) : total === 0 ? (
          <EmptyState>No integrations available for this workspace yet.</EmptyState>
        ) : (
          GROUPS.map((g) => (
            <div key={g.label} className="mb-7">
              <div className="font-mono uppercase text-[11px] tracking-[0.6px] font-semibold text-ink-3 mb-3">{g.label}</div>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                {g.items.map((item) => {
                  const row = byProvider.get(item.provider);
                  const status = (row?.status ?? 'NOT_CONNECTED') as Status;
                  const st = STATUS_STYLE[status];
                  const meta =
                    status === 'CONNECTED' && row?.lastSync
                      ? `Synced ${rel(row.lastSync)}`
                      : status === 'ATTENTION'
                        ? 'Action needed'
                        : 'Available';
                  const pending = connect.isPending && connect.variables === item.provider;
                  return (
                    <div key={item.provider} className="bg-surface rounded-card flex flex-col shadow-rest" style={{ border: `1px solid ${st.border}`, padding: 18 }}>
                      <div className="flex items-start justify-between">
                        <div
                          className="w-[42px] h-[42px] rounded-[11px] flex items-center justify-center text-[15px] font-bold"
                          style={{ background: st.iconBg, color: st.iconColor }}
                        >
                          {item.mark}
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-[5px] rounded-chip" style={{ background: st.bg }}>
                          <Dot color={st.dot} size={6} />
                          <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
                        </div>
                      </div>
                      <div className="mt-3.5 text-[15px] font-semibold">{item.name}</div>
                      <div className="mt-1 text-[12px] text-ink-2b leading-relaxed flex-1">{item.desc}</div>
                      <div className="mt-3.5 flex items-center justify-between">
                        <span className="fig text-[10.5px] text-ink-3">{meta}</span>
                        {status === 'CONNECTED' ? (
                          <Button variant="secondary" className="h-8 px-3.5 text-[11.5px]" disabled={pending} onClick={() => connect.mutate(item.provider)}>
                            {pending ? <Spinner /> : 'Manage'}
                          </Button>
                        ) : status === 'ATTENTION' ? (
                          <button
                            className="inline-flex items-center justify-center h-8 px-3.5 rounded-[9px] text-[11.5px] font-semibold text-white transition-all disabled:opacity-50"
                            style={{ background: '#9A6212', border: '1px solid #9A6212' }}
                            disabled={pending}
                            onClick={() => connect.mutate(item.provider)}
                          >
                            {pending ? <Spinner /> : 'Reconnect'}
                          </button>
                        ) : (
                          <Button className="h-8 px-3.5 text-[11.5px]" disabled={pending} onClick={() => connect.mutate(item.provider)}>
                            {pending ? <Spinner /> : 'Connect'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
