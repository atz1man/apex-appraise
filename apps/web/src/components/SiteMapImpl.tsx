import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { trpc } from '../lib/trpc';
import { brand, brandMarkGradient, fixed, onFill } from '@apex/ui-tokens';

/**
 * The implementation, behind a lazy boundary — see SiteMap.tsx.
 *
 * Everything Leaflet is in THIS file so it can only ever arrive with a map that
 * is actually being drawn.
 */
export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  kind?: 'subject' | 'comp';
}

/** div-icon markers — no image assets, tokens-only colours */
const icon = (kind: 'subject' | 'comp') =>
  L.divIcon({
    className: '',
    html:
      kind === 'subject'
        ? `<div style="width:26px;height:26px;border-radius:9px;background:${brandMarkGradient};box-shadow:0 2px 8px rgba(20,30,25,.4);display:flex;align-items:center;justify-content:center">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${onFill}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/></svg>
           </div>`
        : `<div style="width:14px;height:14px;border-radius:50%;background:${brand[400]};border:2.5px solid ${onFill};box-shadow:0 1px 4px rgba(20,30,25,.45)"></div>`,
    iconSize: kind === 'subject' ? [26, 26] : [14, 14],
    iconAnchor: kind === 'subject' ? [13, 13] : [7, 7],
  });

/**
 * Real interactive map. Subject site gets the brand house pin; comparables get
 * mint dots with popups.
 *
 * Tiles come from THIS application, not from tile.openstreetmap.org directly.
 * Pointing the browser at a public tile server told that server the IP address
 * of every valuer and the coordinates of every site they opened — the last
 * third-party request left on any page, on a privacy notice that says "Nobody
 * else." The API proxies and caches them under a User-Agent that identifies us,
 * which is what OSM's tile policy asks for and what a browser cannot provide.
 */
export default function SiteMap({ pins, height = 300 }: { pins: MapPin[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  /**
   * The tile URL carries a short-lived token, so the map waits for it. Without
   * this gate Leaflet would fire a screenful of unauthorised tile requests on
   * first paint and cache the failures.
   */
  const { data: mapConfig } = trpc.org.mapConfig.useQuery(undefined, {
    /**
     * Just under the token's own half-hour life. The tile URL carries the token,
     * so a new token is a new URL and a whole screen of browser-cached tiles
     * stops matching — refetching them from us costs a round trip each. Rotating
     * once per session rather than every ten minutes keeps that rare, and the
     * proxy's cache means even then nothing extra reaches the tile server.
     */
    staleTime: 25 * 60_000,
  });

  useEffect(() => {
    if (!el.current || pins.length === 0 || !mapConfig) return;
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer(mapConfig.tileUrl, {
      maxZoom: mapConfig.maxZoom,
      attribution: mapConfig.attribution,
    }).addTo(map);
    const group = L.featureGroup(
      pins.map((p) =>
        L.marker([p.lat, p.lng], { icon: icon(p.kind ?? 'comp') }).bindPopup(
          `<div style="font:600 12px 'Schibsted Grotesk',sans-serif">${p.label}</div>${p.sub ? `<div style="font:500 11px 'JetBrains Mono',monospace;color:${fixed.inkMuted};margin-top:2px">${p.sub}</div>` : ''}`,
        ),
      ),
    ).addTo(map);
    map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 16 });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins), mapConfig?.tileUrl]);

  if (pins.length === 0) return null;
  return <div ref={el} style={{ height }} className="rounded-[12px] overflow-hidden border border-border-strong z-0" />;
}
