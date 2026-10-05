import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INTEGRATION_CONNECTORS, type IntegrationProvider } from '@apex/types/integrations';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { Button, Dot, Drawer, EmptyState, Listbox, Skeleton, TopBar } from '../components/ui';
import { neutral } from '@apex/ui-tokens';
import { workingDeal } from '../lib/working-deal';

/**
 * Which providers do what, read from the one table rather than listed here.
 *
 * `SYNCABLE` was a hand-kept set of three — Land Registry, EPC and PriceHubble —
 * and two of them did not sync anything real: EPC created a Document row for a
 * certificate PDF that did not exist, and PriceHubble wrote an invented £212/ft²
 * comparable onto the deal's evidence. `INTEGRATION_CONNECTORS` says which
 * providers this server can contact, which of those sync onto a deal, and what a
 * firm should use instead where there is no connector, and the server refuses on
 * the same table — so a card cannot offer a button the procedure behind it will
 * reject.
 */
const connectorFor = (provider: IntegrationProvider) => INTEGRATION_CONNECTORS[provider];

type Status = 'CONNECTED' | 'ATTENTION' | 'NOT_CONNECTED';

interface ProviderMeta {
  /**
   * The DB key, and the enum `integrations.connect` accepts. Typed rather than
   * `string` so a card naming a provider the server will not take is a
   * typecheck failure here rather than a Connect button that 400s in front of a
   * customer — the two lists were separate copies of the same strings.
   */
  provider: IntegrationProvider;
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
      { provider: 'PriceHubble AVM', name: 'PriceHubble AVM', mark: 'PH', desc: 'Third-party automated valuation and market intelligence, sold as a subscription.' },
    ],
  },
  {
    label: 'Planning & geospatial',
    items: [
      /**
       * Renamed to what it reads. The card said "application history, decision
       * notices and conditions", which is the commercial submission service; the
       * connector behind it is planning.data.gov.uk, whose answer is
       * designations and constraints. The DB value stays 'Planning Portal'
       * because rows carry it.
       */
      { provider: 'Planning Portal', name: 'Planning data', mark: 'PD', desc: 'Designations and constraints intersecting the site, from planning.data.gov.uk — conservation areas, listed buildings, flood zones, green belt.' },
      { provider: 'Ordnance Survey', name: 'Ordnance Survey', mark: 'OS', desc: 'Ordnance Survey mapping and boundaries, through the OS Data Hub.' },
      { provider: 'Environment Agency', name: 'Environment Agency', mark: 'EA', desc: 'Flood-risk zones and contaminated-land screening for site due diligence.' },
    ],
  },
  {
    label: 'Cost, finance & workflow',
    items: [
      { provider: 'BCIS', name: 'BCIS cost data', mark: 'BC', desc: 'RICS published building-cost indices by use and region.' },
      { provider: 'Xero', name: 'Xero', mark: 'XE', desc: 'Push committed costs and drawdowns into accounting for live cost monitoring.' },
      { provider: 'DocuSign', name: 'DocuSign', mark: 'DS', desc: 'Third-party e-signature for sending documents out to be signed.' },
    ],
  },
];

const STATUS_STYLE: Record<Status, { label: string; dot: string; bg: string; color: string; border: string; iconBg: string; iconColor: string }> = {
  CONNECTED: {
    label: 'Connected',
    dot: 'rgb(var(--status-green, 30 122 85))',
    bg: 'rgb(var(--tint-success-2, 228 241 234))',
    color: 'rgb(var(--status-green, 30 122 85))',
    border: neutral.borderGreenSoft,
    iconBg: 'rgb(var(--tint-success, 236 243 239))',
    iconColor: 'rgb(var(--brand-ink, 20 80 59))',
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
  const { data, isLoading, error: listError, refetch: refetchList } = trpc.integrations.list.useQuery();
  const rows = data?.connections;
  /**
   * Whether a provider takes the workspace's own API key — a fact about the
   * PROVIDER, read from the catalogue rather than from a row. It used to be
   * `row.selfServe`, so it existed only where a row happened to exist, and a
   * workspace with no Companies House row could not open the drawer that is the
   * only way to give this product a Companies House key.
   */
  const selfServe = data?.selfServe;
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
  const effectiveDealId = syncDealId || workingDeal(deals)?.id || '';

  const byProvider = new Map((rows ?? []).map((r) => [r.provider, r]));
  /**
   * Counted over the providers that CAN be connected, not over the rows that
   * happen to exist. A leftover row for a provider with no connector would
   * otherwise be counted as connected, and the total would be however many rows
   * a workspace had rather than how many connections are on offer.
   */
  const offered = GROUPS.flatMap((g) => g.items).filter((i) => connectorFor(i.provider).connects);
  const connected = offered.filter((i) => byProvider.get(i.provider)?.status === 'CONNECTED').length;
  const total = offered.length;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/" className="text-inactive hover:text-brand-ink">Hub</Link>
            {' / '}Data &amp; integrations
          </span>
        }
        right={
          /**
            * `!!data`, not just a count. "0 of 6 connected" is as much a claim
            * about the firm's record as any empty state, and the catalogue's own
            * length is now a constant — so without this the header asserted that
            * nothing was connected on a query that had failed. The sweep's
            * matcher does not read a figure as a claim; the rule is not the
            * sweep's wording.
            */
          !!data && total > 0 && (
            <span className="inline-flex items-center gap-2 rounded-[9px] bg-tint-success px-3 py-1.5 text-[11.5px] font-semibold text-brand-ink">
              <Dot color="rgb(var(--status-green, 30 122 85))" /> {connected} of {total} connected
            </span>
          )
        }
      />

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-8 mb-5">
          <div className="text-[32px] font-bold tracking-[-1.2px]">Connect your data sources</div>
          <div className="mt-1 text-[13.5px] text-ink-3 max-w-[620px] leading-relaxed">
            Live data feeds make extraction trustworthy and appraisals defensible — comparable evidence, planning, EPCs and mapping flow
            straight into every deal.
          </div>
          {deals.length > 0 && (
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <span className="label-mono text-ink-3">Sync target deal</span>
              <Listbox
                value={effectiveDealId}
                options={deals.map((d) => ({ value: d.id, label: d.name }))}
                onChange={setSyncDealId}
                ariaLabel="Sync target deal"
                className="min-w-0 max-w-full"
              />
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={196} className="rounded-card" />
            ))}
          </div>
        ) : listError || !data ? (
          /**
            * The failure, not the catalogue.
            *
            * The catalogue is a constant and could be drawn without the server —
            * but the STATUSES cannot, and a card reading "Not connected" on a
            * query that failed is precisely the conflation `lib/load-failure.ts`
            * exists to end: it says the firm has not connected this provider when
            * the truth is we could not look.
            *
            * The condition used to be `total === 0`, over `rows?.length ?? 0`,
            * which handled the failure by accident and brought a defect of its own
            * — a workspace that has never connected anything has NO rows, so a
            * newly registered firm was shown "No integrations available for this
            * workspace yet" and no cards at all, which is every firm on its first
            * day since `integrations.list` stopped backfilling a placeholder row
            * per provider. The demo seed had rows, so nobody saw it. There is no
            * "no integrations" state any more, because the catalogue is ours and
            * always exists; what varies is whether each one is connected.
            */
          <EmptyState error={listError} what="your integrations" onRetry={() => refetchList()}>
            Integrations could not be loaded.
          </EmptyState>
        ) : (
          GROUPS.map((g) => (
            <div key={g.label} className="mb-7">
              <div className="font-mono uppercase text-[11px] tracking-[0.6px] font-semibold text-ink-3 mb-3">{g.label}</div>
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map((item) => {
                  const row = byProvider.get(item.provider);
                  const connector = connectorFor(item.provider);
                  /**
                   * A provider with no connector is never CONNECTED, whatever a
                   * row left over from before this table says — a stored
                   * `status` is the record of a click the server should not have
                   * accepted, and showing a green dot for it would keep the old
                   * claim alive on exactly the screen that made it.
                   */
                  const status = (connector.connects ? (row?.status ?? 'NOT_CONNECTED') : 'NOT_CONNECTED') as Status;
                  const st = STATUS_STYLE[status];
                  const meta = !connector.connects
                    ? 'No connector'
                    : status === 'CONNECTED' && row?.lastSync
                      ? `Synced ${rel(row.lastSync)}`
                      : status === 'ATTENTION'
                        ? 'Action needed'
                        : connector.auth === 'key'
                          ? 'Needs your API key'
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
                      {/* what a firm should use instead, because a dead end with
                          no alternative is worse than the false claim it replaces */}
                      {!connector.connects && (
                        <div className="mt-2.5 rounded-[8px] px-2.5 py-1.5 text-[11px] text-ink-2" style={{ background: 'rgb(var(--sunken, 251 252 251))' }}>
                          {connector.instead}
                        </div>
                      )}
                      {connector.connects && (
                        <div className="mt-2.5 fig text-[10.5px] text-ink-3">Feeds {connector.feeds.toLowerCase()}</div>
                      )}
                      {syncResult[item.provider] && (
                        <div className="mt-2.5 rounded-[8px] bg-tint-success px-2.5 py-1.5 text-[11px] text-brand-ink">
                          Pulled {syncResult[item.provider]} onto the selected deal.
                        </div>
                      )}
                      <div className="mt-3.5 flex items-center justify-between">
                        <span className="fig text-[10.5px] text-ink-3">{meta}</span>
                        {status === 'CONNECTED' ? (
                          <div className="flex gap-1.5">
                            {connector.connects && connector.syncs && effectiveDealId && (
                              <Button writes
                                size="sm"
                                className="min-h-10 sm:min-h-0"
                                loading={sync.isPending && sync.variables?.provider === item.provider}
                                onClick={() => sync.mutate({ provider: item.provider, dealId: effectiveDealId })}
                              >
                                Sync to deal
                              </Button>
                            )}
                            <Button writes
                              variant="secondary"
                              size="sm"
                              className="min-h-10 sm:min-h-0"
                              loading={pending}
                              onClick={() => (selfServe?.[item.provider] ? setCredProvider(item.provider) : connect.mutate(item.provider))}
                            >
                              Manage
                            </Button>
                          </div>
                        ) : !connector.connects ? (
                          /* no button at all: the server refuses this provider,
                             and a control that exists to be rejected is worse
                             than no control. The sentence above says what to use. */
                          null
                        ) : status === 'ATTENTION' ? (
                          <Button writes size="sm" className="min-h-10 sm:min-h-0" loading={pending} onClick={() => connect.mutate(item.provider)}>
                            Reconnect
                          </Button>
                        ) : (
                          <Button writes
                            size="sm"
                            className="min-h-10 sm:min-h-0"
                            loading={pending}
                            onClick={() => (selfServe?.[item.provider] ? setCredProvider(item.provider) : connect.mutate(item.provider))}
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
        const spec = credProvider ? selfServe?.[credProvider] : undefined;
        if (!credProvider || !spec) return null;
        const isConnected = row?.status === 'CONNECTED';
        const valid = spec.fields.every((f) => credFields[f.key]?.trim());
        return (
          <Drawer open onClose={() => { setCredProvider(null); setCredFields({}); }} title={`Connect ${credProvider}`}>
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-ink-2 leading-relaxed">
                {credProvider} uses your workspace&rsquo;s own free API key. Get one at{' '}
                <a href={spec.signupUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink hover:text-brand-ink">
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
                <Button writes
                  loading={saveCreds.isPending}
                  disabled={!valid}
                  onClick={() => saveCreds.mutate({ provider: credProvider as 'EPC Register' | 'Companies House', fields: credFields })}
                >
                  {isConnected ? 'Replace key' : 'Validate & connect'}
                </Button>
                <Button variant="ghost" onClick={() => { setCredProvider(null); setCredFields({}); }}>Cancel</Button>
                {isConnected && (
                  <Button writes
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
