import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { Button, Dot, Drawer, EmptyState, Skeleton, TopBar } from '../components/ui';

/** providers with a demo/mock sync that populates real deal data */
const SYNCABLE = new Set(['HM Land Registry', 'EPC Register', 'PriceHubble AVM']);

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
      { provider: 'Companies House', name: 'Companies House', mark: 'CH', desc: 'Counterparty due diligence — officers, charges and filing status on the site pack.' },
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
  CONNECTED: {
    label: 'Connected',
    dot: 'rgb(var(--status-green, 30 122 85))',
    bg: 'rgb(var(--tint-success-2, 228 241 234))',
    color: 'rgb(var(--status-green, 30 122 85))',
    border: '#BFE0CD',
    iconBg: 'rgb(var(--tint-success, 236 243 239))',
    iconColor: '#14503B',
  },
  ATTENTION: {
    label: 'Attention',
    dot: 'rgb(var(--status-amber-dot, 199 169 91))',
    bg: 'rgb(var(--status-amber-bg, 248 240 222))',
    color: 'rgb(var(--status-amber, 154 98 18))',
    border: 'rgb(var(--status-amber-bg, 248 240 222))',
    iconBg: 'rgb(var(--status-amber-bg, 248 240 222))',
    iconColor: 'rgb(var(--status-amber, 154 98 18))',
  },
  NOT_CONNECTED: {
    label: 'Not connected',
    dot: 'rgb(var(--ink-3, 154 160 154))',
    bg: 'rgb(var(--sunken-2, 240 239 233))',
    color: 'rgb(var(--inactive, 138 144 138))',
    border: 'rgb(var(--border-strong, 230 229 222))',
    iconBg: 'rgb(var(--canvas, 243 244 241))',
    iconColor: 'rgb(var(--ink-2b, 110 114 105))',
  },
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
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.integrations.list.useQuery();
  const connect = trpc.integrations.connect.useMutation({ onSuccess: () => utils.integrations.list.invalidate() });
  // self-serve key flow: drawer with the provider's fields, validated live on save
  const [credProvider, setCredProvider] = useState<string | null>(null);
  const [credFields, setCredFields] = useState<Record<string, string>>({});
  const saveCreds = trpc.integrations.saveCredentials.useMutation({
    onSuccess: (res) => {
      utils.integrations.list.invalidate();
      setCredProvider(null);
      setCredFields({});
      toast.success(`${res.provider} connected — key validated against the live API`);
    },
  });
  const disconnect = trpc.integrations.disconnect.useMutation({
    onSuccess: () => {
      utils.integrations.list.invalidate();
      setCredProvider(null);
      setCredFields({});
      toast.success('Disconnected — the stored key has been removed');
    },
  });
  const { data: dealsData } = trpc.deals.list.useQuery({});
  const [syncDealId, setSyncDealId] = useState('');
  const [syncResult, setSyncResult] = useState<Record<string, string>>({});
  const sync = trpc.integrations.sync.useMutation({
    onSuccess: (res, vars) => {
      setSyncResult((s) => ({ ...s, [vars.provider]: res.created }));
      utils.integrations.list.invalidate();
      utils.comparables.list.invalidate();
      utils.documents.list.invalidate();
    },
  });
  const deals = dealsData?.deals ?? [];
  const effectiveDealId = syncDealId || deals.find((d) => d.name.startsWith('Northgate'))?.id || deals[0]?.id || '';

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
              <Dot color="rgb(var(--status-green, 30 122 85))" /> {connected} of {total} connected
            </span>
          )
        }
      />

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-6 mb-5">
          <div className="text-[22px] font-bold tracking-[-0.6px]">Connect your data sources</div>
          <div className="mt-1 text-[13.5px] text-ink-3 max-w-[620px] leading-relaxed">
            Live data feeds make extraction trustworthy and appraisals defensible — comparable evidence, planning, EPCs and mapping flow
            straight into every deal.
          </div>
          {deals.length > 0 && (
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <span className="label-mono text-ink-3">Sync target deal</span>
              <select value={effectiveDealId} onChange={(e) => setSyncDealId(e.target.value)} className="h-8 min-w-0 max-w-full" aria-label="Sync target deal">
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={196} className="rounded-card" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState>No integrations available for this workspace yet.</EmptyState>
        ) : (
          GROUPS.map((g) => (
            <div key={g.label} className="mb-7">
              <div className="font-mono uppercase text-[11px] tracking-[0.6px] font-semibold text-ink-3 mb-3">{g.label}</div>
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
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
                      {syncResult[item.provider] && (
                        <div className="mt-2.5 rounded-[8px] bg-tint-success px-2.5 py-1.5 text-[11px] text-brand-700">
                          Pulled {syncResult[item.provider]} onto the selected deal.
                        </div>
                      )}
                      <div className="mt-3.5 flex items-center justify-between">
                        <span className="fig text-[10.5px] text-ink-3">{meta}</span>
                        {status === 'CONNECTED' ? (
                          <div className="flex gap-1.5">
                            {SYNCABLE.has(item.provider) && effectiveDealId && (
                              <Button
                                size="sm"
                                className="min-h-10 sm:min-h-0"
                                loading={sync.isPending && sync.variables?.provider === item.provider}
                                onClick={() => sync.mutate({ provider: item.provider, dealId: effectiveDealId })}
                              >
                                Sync to deal
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-h-10 sm:min-h-0"
                              loading={pending}
                              onClick={() => (row?.selfServe ? setCredProvider(item.provider) : connect.mutate(item.provider))}
                            >
                              Manage
                            </Button>
                          </div>
                        ) : status === 'ATTENTION' ? (
                          <Button size="sm" className="min-h-10 sm:min-h-0" loading={pending} onClick={() => connect.mutate(item.provider)}>
                            Reconnect
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="min-h-10 sm:min-h-0"
                            loading={pending}
                            onClick={() => (row?.selfServe ? setCredProvider(item.provider) : connect.mutate(item.provider))}
                          >
                            Connect
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

      {/* self-serve key drawer — validated live before it's stored */}
      {(() => {
        const row = credProvider ? byProvider.get(credProvider) : undefined;
        const spec = row?.selfServe;
        if (!credProvider || !spec) return null;
        const isConnected = row?.status === 'CONNECTED';
        const valid = spec.fields.every((f) => credFields[f.key]?.trim());
        return (
          <Drawer open onClose={() => { setCredProvider(null); setCredFields({}); }} title={`Connect ${credProvider}`}>
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-ink-2 leading-relaxed">
                {credProvider} uses your workspace&rsquo;s own free API key. Get one at{' '}
                <a href={spec.signupUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-500 hover:text-brand-700">
                  {spec.signupUrl.replace('https://', '')}
                </a>
                {' '}— the key is checked against the live API before it&rsquo;s saved, stored server-side only, and never shown again.
              </p>
              {spec.fields.map((f) => (
                <div key={f.key}>
                  <label htmlFor={`cred-${f.key}`} className="label-mono text-ink-3 block mb-1">{f.label}</label>
                  <input
                    id={`cred-${f.key}`}
                    className="w-full fig"
                    type={f.key === 'key' ? 'password' : 'text'}
                    autoComplete="off"
                    value={credFields[f.key] ?? ''}
                    onChange={(e) => setCredFields((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button
                  loading={saveCreds.isPending}
                  disabled={!valid}
                  onClick={() => saveCreds.mutate({ provider: credProvider as 'EPC Register' | 'Companies House', fields: credFields })}
                >
                  {isConnected ? 'Replace key' : 'Validate & connect'}
                </Button>
                <Button variant="ghost" onClick={() => { setCredProvider(null); setCredFields({}); }}>Cancel</Button>
                {isConnected && (
                  <Button
                    variant="danger"
                    className="ml-auto"
                    loading={disconnect.isPending}
                    onClick={() => disconnect.mutate(credProvider as 'EPC Register' | 'Companies House')}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
              {isConnected && row?.hasCredentials && (
                <div className="text-[11.5px] text-ink-3">A key is on file for this workspace. Replacing it re-validates against the live API.</div>
              )}
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
}
