import { Link, useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';

export type DealTool =
  | 'overview'
  | 'sitepack'
  | 'appraisal'
  | 'auto'
  | 'comparables'
  | 'scenarios'
  | 'costs'
  | 'sales'
  | 'dataroom'
  | 'workbench'
  | 'report'
  | 'redbook';

const TOOLS: Array<[DealTool, string, string]> = [
  ['overview', 'Overview', ''],
  ['sitepack', 'Site pack', '/sitepack'],
  ['appraisal', 'Appraisal', '/appraisal'],
  ['auto', 'Auto-Appraisal', '/auto'],
  ['comparables', 'Comparables', '/comparables'],
  ['scenarios', 'Scenarios', '/scenarios'],
  ['costs', 'Costs', '/costs'],
  ['sales', 'Sales', '/sales'],
  ['dataroom', 'Data room', '/dataroom'],
  ['workbench', 'Workbench', '/workbench'],
  ['report', 'Report', '/report'],
  ['redbook', 'Red Book', '/redbook'],
];

/**
 * Deal-scoped navigation strip: every tool on the current deal, one click away,
 * plus a switcher to jump to the same tool on another deal.
 */
export function DealNav({ dealId, active }: { dealId: string; active: DealTool }) {
  const navigate = useNavigate();
  const { data } = trpc.deals.list.useQuery({});
  const activePath = TOOLS.find(([k]) => k === active)?.[2] ?? '';
  return (
    <nav className="sticky top-14 z-30 bg-surface/95 border-b border-border-std px-5 flex items-center gap-0.5 overflow-x-auto backdrop-blur">
      {TOOLS.map(([key, label, path]) => (
        <Link
          key={key}
          to={`/deal/${dealId}${path}`}
          className="px-2.5 py-2 text-[12px] whitespace-nowrap transition-colors"
          style={{
            borderBottom: `2px solid ${active === key ? '#14503B' : 'transparent'}`,
            color: active === key ? 'rgb(var(--ink, 22 32 27))' : 'rgb(var(--inactive, 138 144 138))',
            fontWeight: active === key ? 600 : 500,
          }}
        >
          {label}
        </Link>
      ))}
      {data && data.deals.length > 1 && (
        <select
          className="ml-auto my-1.5 h-7 text-[11.5px] max-w-[220px]"
          value={dealId}
          onChange={(e) => navigate(`/deal/${e.target.value}${activePath}`)}
          aria-label="Switch deal"
        >
          {data.deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </nav>
  );
}
