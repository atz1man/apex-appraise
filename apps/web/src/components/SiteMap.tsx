import { Suspense, lazy, useState } from 'react';
import { Button, Skeleton } from './ui';
import { StaticMap } from './StaticMap';
import { trpc } from '../lib/trpc';
import type { MapPin } from './SiteMapImpl';
export type { MapPin } from './SiteMapImpl';

// The tile renderer stays lazy: evidence without coordinates downloads no Leaflet.
const Impl = lazy(() => import('./SiteMapImpl'));

export function SiteMap({ pins, height = 300, interactive = false, maptype, zoom, controls = true }: {
  pins: MapPin[];
  height?: number;
  interactive?: boolean;
  maptype?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  zoom?: number;
  /** Printed workfiles keep a quiet map, without screen-only controls. */
  controls?: boolean;
}) {
  const { data: config, isLoading, error, refetch } = trpc.org.mapConfig.useQuery(undefined, { staleTime: 25 * 60_000 });
  const [view, setView] = useState<'imagery' | 'interactive'>(interactive ? 'interactive' : 'imagery');
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  // Validate only; projection, bounds and distances stay in the map/engine.
  const located = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
  const imageKey = JSON.stringify([config?.staticMapUrl, located, height, maptype, zoom]);
  const imagery = view === 'imagery' && !!config?.staticMapUrl && failedImage !== imageKey && located.length <= 40;

  if (!located.length) return <div className="rounded-card border border-border-strong bg-sunken p-4 text-[12px] text-ink-3">No valid coordinates to plot. Add a postcode or location to this evidence.</div>;
  if (isLoading) return <Skeleton height={height} />;
  if (error || !config) return (
    <div role="status" className="rounded-card border border-border-strong bg-sunken p-4 text-[12px] text-ink-3">
      <p>Map access could not be loaded. The property evidence is still available below.</p>
      <Button size="sm" className="mt-2" onClick={() => void refetch()}>Retry map</Button>
    </div>
  );

  return (
    <div className="min-w-0">
      {controls && (
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap print:hidden">
          <div role="group" aria-label="Map view" className="inline-flex gap-1">
            <button type="button" aria-pressed={!imagery} className={`rounded-[7px] px-3 py-1.5 text-[11px] font-semibold ${!imagery ? 'bg-tint-success text-brand-ink' : 'bg-sunken text-ink-2'}`} onClick={() => setView('interactive')}>Street map</button>
            {config.staticMapUrl && located.length <= 40 && <button type="button" aria-pressed={imagery} className={`rounded-[7px] px-3 py-1.5 text-[11px] font-semibold ${imagery ? 'bg-tint-success text-brand-ink' : 'bg-sunken text-ink-2'}`} onClick={() => { setFailedImage(null); setView('imagery'); }}>Aerial image</button>}
          </div>
          {!imagery && <Button size="sm" onClick={() => setReset((v) => v + 1)}>Fit properties</Button>}
        </div>
      )}
      {failedImage === imageKey && <p role="status" className="mb-2 text-[11px] text-ink-3">Aerial imagery is unavailable. Showing the street map.</p>}
      {imagery ? (
        <StaticMap key={imageKey} pins={located} height={height} urlPrefix={config.staticMapUrl!}
          attribution={config.staticMapAttribution ?? 'Map data ©Google'} maptype={maptype} zoom={zoom}
          onError={() => setFailedImage(imageKey)} />
      ) : (
        <Suspense fallback={<Skeleton height={height} />}><Impl pins={located} height={height} reset={reset} /></Suspense>
      )}
      {controls && <p className="mt-2 text-[10.5px] text-ink-3 print:hidden">{located.length} {located.length === 1 ? 'property' : 'properties'} plotted{located.length < pins.length ? ' · some coordinates unavailable' : ''}. {imagery ? 'Static imagery; switch to street map to explore.' : 'Drag to explore; use + and − to zoom. Select a pin for its evidence.'}</p>}
    </div>
  );
}
