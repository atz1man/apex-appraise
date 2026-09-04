import { Suspense, lazy } from 'react';
import { Skeleton } from './ui';
import { StaticMap } from './StaticMap';
import { trpc } from '../lib/trpc';
export type { MapPin } from './SiteMapImpl';

/**
 * The map, and the choice of which map.
 *
 * Leaflet is 150K and stays behind a lazy boundary. It used to be imported
 * statically here AND by Comparables and the Site Pack, so opening either route
 * downloaded the whole library before anything could paint — including on a
 * Comparables page where nothing had been geocoded and no tile would ever be
 * drawn. CLAUDE.md's rule ("heavy deps stay lazy-loaded") was satisfied to the
 * letter, because leaflet was not in the MAIN bundle; it had simply moved into a
 * shared chunk that arrived just as eagerly.
 *
 * Now this component also decides between two maps, and every surface that
 * draws one goes through here — the Site Pack, Comparables and the Red Book —
 * so the decision is made once rather than three times.
 *
 * WITH a Google key configured, that is a Static Map: aerial imagery, fetched
 * server-side so the browser never contacts Google. Without one it is the tile
 * map, unchanged. The fallback is the DEFAULT rather than the unhappy path —
 * the public demo has no Google account and CI has no key, and both must draw a
 * working map.
 *
 * The trade is honest and worth stating: the static map does not pan or zoom.
 * For the Red Book and the Site Pack that costs nothing, since both are headed
 * for a printed page. On Comparables it trades panning for being able to SEE
 * the sites — which is what somebody checking whether a comparable is really
 * comparable is looking for. `interactive` is there for a caller that would
 * rather have the drag.
 */
const Impl = lazy(() => import('./SiteMapImpl'));

export function SiteMap({
  pins,
  height = 300,
  interactive = false,
  maptype,
  zoom,
}: {
  pins: import('./SiteMapImpl').MapPin[];
  height?: number;
  /** force the tile map even where imagery is available */
  interactive?: boolean;
  maptype?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  zoom?: number;
}) {
  /**
   * Shared with `SiteMapImpl` through react-query's cache, so choosing a map
   * costs no extra request — the tile map needs this same config for its token.
   */
  const { data: config, isLoading } = trpc.org.mapConfig.useQuery(undefined, { staleTime: 25 * 60_000 });

  if (isLoading) return <Skeleton height={height} />;

  if (!interactive && config?.staticMapUrl) {
    return (
      <StaticMap
        pins={pins}
        height={height}
        urlPrefix={config.staticMapUrl}
        attribution={config.staticMapAttribution ?? 'Map data ©Google'}
        maptype={maptype}
        zoom={zoom}
      />
    );
  }

  return (
    <Suspense fallback={<Skeleton height={height} />}>
      <Impl pins={pins} height={height} />
    </Suspense>
  );
}
