import { useEffect, useRef } from "react";
import { useApp } from "../App";
import { cx } from "../lib/format";
import { nextGlowSpot, type GlowSpot } from "../lib/glow";

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The red light behind a page. Each glow drifts to a new random spot through a CSS transition, so this only has to
 * pick a destination every few seconds. It holds still when the person turned it off in Settings or asked Windows for
 * less motion, and it rests while the window is hidden, because the app keeps running in the tray.
 */
export function Glow({ soft }: { soft?: boolean }) {
  const { backgroundMotion } = useApp();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const glows = [...root.current!.children] as HTMLElement[];
    const spots: GlowSpot[] = [];
    const timers: number[] = [];

    const place = (el: HTMLElement, i: number) => {
      const others = spots.filter((_, j) => j !== i);
      const spot = nextGlowSpot(others, { width: window.innerWidth, height: window.innerHeight });
      spots[i] = spot;
      el.style.transform = `translate3d(${spot.x}vw, ${spot.y}vh, 0) translate(-50%, -50%) scale(${rand(0.85, 1.2).toFixed(2)})`;
      el.style.opacity = rand(0.85, 1).toFixed(2);
    };

    glows.forEach((el, i) => {
      el.style.transition = "none";
      el.style.willChange = "auto";
      place(el, i);
    });

    if (!backgroundMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const drift = (el: HTMLElement, i: number) => {
      if (document.hidden) return;
      const seconds = rand(7, 12);
      el.style.transition = `transform ${seconds}s cubic-bezier(.37,0,.63,1), opacity ${seconds}s linear`;
      place(el, i);
      timers[i] = window.setTimeout(() => drift(el, i), seconds * 1000);
    };

    glows.forEach((el, i) => {
      el.style.willChange = "transform, opacity";
      timers[i] = window.setTimeout(() => drift(el, i), 50 + i * 700);
    });

    const onVisibility = () => {
      timers.forEach((t) => clearTimeout(t));
      if (!document.hidden) glows.forEach(drift);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [backgroundMotion]);

  return (
    <div ref={root} className={cx("glow", soft && "glow-soft")} aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
