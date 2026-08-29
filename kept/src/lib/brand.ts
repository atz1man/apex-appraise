/**
 * The tagline, in one place.
 *
 * It was three literals — the landing hero, the landing footer, and the line
 * under Settings — and changing one left the other two saying something else,
 * which is the drift this codebase keeps finding in prices and store windows.
 * A tagline is not load-bearing the way a price is, but it is the first thing
 * on the page someone reads before installing and the last thing in the app
 * they read after, and those two should not be different claims.
 *
 * The words themselves changed too. "WORK HARD · PLAY HARD" sat in the most
 * prominent typographic slot the hero has and said nothing about returns,
 * money or privacy — generic hustle copy in a product about not losing £61 to
 * a shop. Same rhythm, same two beats and middot; now about the thing being
 * sold. One export to revert if the brand disagrees.
 */
export const TAGLINE = 'shop hard · return harder';

/** The hero and the landing footer set it in caps; Settings sets it in prose. */
export const TAGLINE_CAPS = TAGLINE.toUpperCase();
