import { Link, useNavigate } from 'react-router-dom';
import { clearSession, getPrincipal, trpc } from '../lib/trpc';
import { fM } from '../lib/format';
import { Avatar, Icon, Spinner, TopBar, SPARKLE } from '../components/ui';

const ICONS: Record<string, string> = {
  board: 'M3 5h5v14H3zM10 5h5v9h-5zM17 5h4v6h-4z',
  auto: SPARKLE,
  appraisal: 'M4 4h16v16H4z|M8 12h8|M8 8h8|M8 16h5',
  comps: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z|M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  scenarios: 'M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01',
  costs: 'M12 2v20|M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  sales: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M22 21v-2a4 4 0 0 0-3-3.87',
  dataroom: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  bench: 'M18 20V10|M12 20V4|M6 20v-6',
  investor: 'M12 1v22|M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  integrations: 'M9 3H5a2 2 0 0 0-2 2v4|M15 3h4a2 2 0 0 1 2 2v4|M15 21h4a2 2 0 0 0 2-2v-4|M9 21H5a2 2 0 0 1-2-2v-4',
};

export default function Hub() {
  const navigate = useNavigate();
  const principal = getPrincipal();
  const { data, isLoading } = trpc.deals.list.useQuery({});
  const flagship = data?.deals.find((d) => d.name.startsWith('Northgate')) ?? data?.deals[0];
  const dealTools: Array<[string, string, string, string]> = flagship
    ? [
        ['auto', 'Auto-Appraisal', 'Documents in → appraisal out, AI or manual', `/deal/${flagship.id}/auto`],
        ['appraisal', 'Development appraisal', 'Residual, cashflow, finance & returns', `/deal/${flagship.id}/appraisal`],
        ['comps', 'Comparables', 'Adjustment grid → supported £/ft²', `/deal/${flagship.id}/comparables`],
        ['scenarios', 'Scenarios', 'Compare scheme options side-by-side', `/deal/${flagship.id}/scenarios`],
        ['costs', 'Cost monitoring', 'Budget vs actual, contractors, photo log', `/deal/${flagship.id}/costs`],
        ['sales', 'Sales & lettings', 'Unit tracker, progression, rent roll', `/deal/${flagship.id}/sales`],
        ['dataroom', 'Data room', 'Deal documents with live extraction', `/deal/${flagship.id}/dataroom`],
        ['bench', 'Benchmarking', 'Your deals vs the market — the data moat', '/benchmarking'],
        ['investor', 'Investor portal', 'LP positions, cashflows, capital calls', '/portal/investor'],
        ['board', 'Pipeline board', 'Every deal across the lifecycle', '/board'],
        ['integrations', 'Integrations', 'Land Registry, EPC, AVM & more', '/integrations'],
      ]
    : [];

  const R = data?.rollup;
  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Home"
        right={
          <>
            {principal && <Avatar initials={principal.initials} />}
            <button
              className="text-[12px] text-ink-3 hover:text-ink"
              onClick={() => {
                clearSession();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </>
        }
      />
      <main className="max-w-[1480px] mx-auto px-6 pb-14">
        {/* dark evergreen hero with live portfolio summary */}
        <section
          className="mt-6 rounded-[22px] p-8 text-white shadow-dark-card"
          style={{ background: 'linear-gradient(160deg,#13402F 0%,#0F3528 55%,#0C2A20 100%)' }}
        >
          <div className="font-mono uppercase text-[11px] tracking-[2px] text-accent-muted-3 font-semibold">
            Brookfield (personal) · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h1 className="mt-2 text-[34px] font-bold tracking-[-1.4px] leading-tight">
            One connected workfile,
            <br />
            sourcing to completion.
          </h1>
          {isLoading || !R ? (
            <div className="mt-6"><Spinner /></div>
          ) : (
            <div className="mt-7 flex flex-wrap gap-8">
              {(
                [
                  ['Pipeline GDV', fM(R.pipelineGdv)],
                  ['Weighted GDV', fM(R.weightedGdv)],
                  ['Forecast profit', fM(R.forecastProfit)],
                  ['Equity required', fM(R.equityRequired)],
                  ['Active deals', String(R.activeCount)],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <div key={label}>
                  <div className="font-mono uppercase text-[10px] tracking-[1.5px] text-accent-muted-2">{label}</div>
                  <div className="fig mt-1 text-[24px] font-semibold tracking-[-1px] text-accent-300">{value}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* deal tools grid */}
        <section className="mt-9">
          <div className="eyebrow">Deal tools</div>
          <h2 className="mt-1 text-[21px] font-bold tracking-[-0.5px]">Everything on {flagship?.name ?? 'your pipeline'}</h2>
          <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))' }}>
            {dealTools.map(([icon, title, desc, to]) => (
              <Link
                key={title}
                to={to}
                className="group bg-surface border border-border-strong rounded-panel shadow-rest p-5 transition-all hover:-translate-y-1 hover:shadow-float"
              >
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-tint-success text-brand-700">
                  <Icon d={ICONS[icon]} size={18} strokeWidth={1.9} />
                </span>
                <div className="mt-3 text-[14.5px] font-semibold tracking-[-0.2px]">{title}</div>
                <div className="mt-1 text-[12px] text-ink-2 leading-snug">{desc}</div>
              </Link>
            ))}
          </div>
        </section>

        <Link to="/integrations" className="mt-7 inline-flex items-center gap-2 text-[13px] font-semibold text-brand-500 hover:text-brand-700">
          <Icon d={ICONS.integrations} size={15} />
          Connected data sources — Land Registry, EPC, AVM →
        </Link>
      </main>
    </div>
  );
}
