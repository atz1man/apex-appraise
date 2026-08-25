import { Suspense, lazy } from 'react';
import { Skeleton } from './ui';
export type { MapPin } from './SiteMapImpl';

/**
 * The map, behind a lazy boundary.
 *
 * Leaflet is 150K. It used to be imported statically by this component and
 * statically by Comparables and the Site Pack, so opening either route
 * downloaded the whole library before anything could paint — including on a
 * Comparables page where not one comparable had been geocoded and the map would
 * never draw a tile. CLAUDE.md's rule ("heavy deps stay lazy-loaded") was
 * satisfied to the letter, because leaflet was not in the MAIN bundle; it had
 * simply moved into a shared chunk that arrived just as eagerly.
 *
 * Now it arrives with the map. Both call sites render this only when there are
 * pins to show, so a page with nothing to plot never fetches it at all.
 *
 * The props and the module path are unchanged, so no call site had to move.
 */
const Impl = lazy(() => import('./SiteMapImpl'));

export function SiteMap({ pins, height = 300 }: { pins: import('./SiteMapImpl').MapPin[]; height?: number }) {
  return (
    <Suspense fallback={<Skeleton height={height} />}>
      <Impl pins={pins} height={height} />
    </Suspense>
  );
}
