import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
        ? `<div style="width:26px;height:26px;border-radius:9px;background:linear-gradient(135deg,#1E7A55,#14503B);box-shadow:0 2px 8px rgba(20,30,25,.4);display:flex;align-items:center;justify-content:center">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/></svg>
           </div>`
        : `<div style="width:14px;height:14px;border-radius:50%;background:#1E9E6A;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(20,30,25,.45)"></div>`,
    iconSize: kind === 'subject' ? [26, 26] : [14, 14],
    iconAnchor: kind === 'subject' ? [13, 13] : [7, 7],
  });

/**
 * Real interactive map — Leaflet + OpenStreetMap tiles (no API key, no billing).
 * Subject site gets the brand house pin; comparables get mint dots with popups.
 */
export function SiteMap({ pins, height = 300 }: { pins: MapPin[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!el.current || pins.length === 0) return;
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const group = L.featureGroup(
      pins.map((p) =>
        L.marker([p.lat, p.lng], { icon: icon(p.kind ?? 'comp') }).bindPopup(
          `<div style="font:600 12px 'Schibsted Grotesk',sans-serif">${p.label}</div>${p.sub ? `<div style="font:500 11px 'JetBrains Mono',monospace;color:#5F665F;margin-top:2px">${p.sub}</div>` : ''}`,
        ),
      ),
    ).addTo(map);
    map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 16 });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins)]);

  if (pins.length === 0) return null;
  return <div ref={el} style={{ height }} className="rounded-[12px] overflow-hidden border border-border-strong z-0" />;
}
