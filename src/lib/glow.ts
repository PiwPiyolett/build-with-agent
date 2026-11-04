/** The middle of a glow, as a percentage of the window. Below 0 or above 100 means partly off screen. */
export interface GlowSpot {
  x: number;
  y: number;
}

const MIN = -12;
const MAX = 112;
const TRIES = 12;

/**
 * Picks where a glow drifts next: a random spot well away from the others, so the red spreads over the window and
 * never piles up behind the text. The gap is measured in pixels, because a percentage is much longer across a wide
 * window than down it. If no clear spot turns up it takes the last one tried, since moving matters more than the gap.
 */
export function nextGlowSpot(
  others: GlowSpot[],
  view: { width: number; height: number },
  random: () => number = Math.random,
): GlowSpot {
  const gap = 0.38 * Math.min(view.width, view.height);
  const inRange = () => MIN + random() * (MAX - MIN);
  let spot: GlowSpot = { x: 0, y: 0 };
  for (let tries = 0; tries < TRIES; tries++) {
    spot = { x: inRange(), y: inRange() };
    const candidate = spot;
    const clear = others.every(
      (o) => Math.hypot(((candidate.x - o.x) * view.width) / 100, ((candidate.y - o.y) * view.height) / 100) > gap,
    );
    if (clear) break;
  }
  return spot;
}

const MOTION_KEY = "bwa.backgroundMotion";

/** Only a convenience for this laptop: if the browser's storage is unavailable the glow simply keeps moving. */
export function readBackgroundMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveBackgroundMotion(moving: boolean) {
  try {
    localStorage.setItem(MOTION_KEY, moving ? "on" : "off");
  } catch {
    /* see readBackgroundMotion */
  }
}
