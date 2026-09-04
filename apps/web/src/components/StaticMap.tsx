import type { MapPin } from './SiteMapImpl';

/**
 * A Google Static Map, served by this application.
 *
 * An `<img>` rather than a map library, and that is the point rather than a
 * limitation: the browser asks US for one image, we fetch it from Google with
 * the key and signature it never sees, and the privacy notice's "Nobody else"
 * stays true. See `apps/api/src/staticmap.ts` for why the interactive
 * JavaScript API could not be used without breaking that sentence.
 *
 * What it gives up is pan and zoom. What it buys is aerial imagery — the one
 * thing OpenStreetMap genuinely cannot match, and the thing a valuer is looking
 * at the map FOR: what is actually on the site, and what sits around it.
 */
export function StaticMap({
  pins,
  height = 300,
  urlPrefix,
  attribution,
  maptype = 'hybrid',
  zoom,
}: {
  pins: MapPin[];
  height?: number;
  urlPrefix: string;
  attribution: string;
  maptype?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  zoom?: number;
}) {
  /**
   * No `center` and no `zoom` by default: given markers alone Google frames
   * them itself, which is what a comparables map wants — every pin in view
   * without computing a bounding box the projection would then disagree with.
   */
  const encoded = pins.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)},${p.kind === 'comp' ? '0' : '1'}`).join(';');
  const src = `${urlPrefix}&pins=${encodeURIComponent(encoded)}&h=${Math.round(height)}${zoom ? `&zoom=${zoom}` : ''}&maptype=${maptype}`;

  const subject = pins.find((p) => p.kind !== 'comp');
  const others = pins.length - (subject ? 1 : 0);

  return (
    <div className="relative rounded-card overflow-hidden" style={{ height }}>
      {/*
        The alt text is the map's content, not its existence. "Map" tells a
        screen-reader user nothing they could not infer; naming the subject and
        counting what is plotted around it is the information the picture
        carries.
      */}
      <img
        src={src}
        alt={
          subject
            ? `Aerial map of ${subject.label}${others > 0 ? `, with ${others} comparable ${others === 1 ? 'property' : 'properties'} marked` : ''}`
            : `Aerial map with ${pins.length} ${pins.length === 1 ? 'property' : 'properties'} marked`
        }
        width="100%"
        height={height}
        loading="lazy"
        className="w-full h-full object-cover"
      />
      <div
        className="absolute bottom-0 right-0 px-1.5 py-0.5 text-[9.5px] text-ink-2"
        style={{ background: 'rgb(var(--surface, 255 255 255) / 0.82)' }}
      >
        {attribution}
      </div>
    </div>
  );
}
