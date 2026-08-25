/**
 * Initials from a name.
 *
 * Its own module because two routers need it now — org.invite for a colleague
 * and portalAccess for a buyer or an investor — and a second copy would drift
 * into two different avatars for the same person.
 */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('') || 'AA';
