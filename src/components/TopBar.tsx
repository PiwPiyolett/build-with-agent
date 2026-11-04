import { useRef, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { agentLabel } from "../../shared/setupGuide";
import type { RouterStatus } from "../../shared/types";
import { useApp } from "../App";
import { BRAND } from "../lib/brand";
import { cx } from "../lib/format";
import { Led, useSlidingThumb } from "./ui";

export interface CapsuleItem {
  key: string;
  label: ReactNode;
  href: string;
  enabled?: boolean;
  /** shown just before this item, such as the "atau" between two paths */
  before?: ReactNode;
}

/** A row of links in a glass capsule, with a white thumb that slides to the current one. */
export function Capsule({
  items,
  active,
  label,
  current,
  compact,
}: {
  items: CapsuleItem[];
  active: string | null;
  label: string;
  current: "page" | "step";
  compact?: boolean;
}) {
  const box = useRef<HTMLElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingThumb(box, thumb, "a[aria-current]", active);

  return (
    <nav ref={box} className={cx("capsule glass", compact && "capsule-compact")} aria-label={label}>
      <span ref={thumb} className="capsule-thumb" aria-hidden />
      {items.map((item) => {
        const enabled = item.enabled !== false;
        return (
          <span key={item.key} className="contents">
            {item.before}
            <a href={enabled ? item.href : undefined} aria-current={item.key === active ? current : undefined} aria-disabled={!enabled || undefined}>
              {item.label}
            </a>
          </span>
        );
      })}
    </nav>
  );
}

const PAGES: CapsuleItem[] = [
  { key: "home", label: "Halaman Utama", href: "#/" },
  { key: "history", label: "Riwayat", href: "#/riwayat" },
  { key: "help", label: "Bantuan", href: "#/bantuan" },
];

function PageCapsule() {
  const { route } = useApp();
  // A project belongs to Riwayat, so that is what lights up while one is loading.
  const active = route.name === "project" ? "history" : route.name;
  return <Capsule items={PAGES} active={active} label="Halaman" current="page" />;
}

function BrandPill() {
  return (
    <a href="#/" className="topbar-pill glass gap-2.5 pl-[5px] pr-[5px] min-[1120px]:pr-4" aria-label="Build With Agent, ke Halaman Utama">
      <img src={BRAND.logo} alt="" width={36} height={36} className="rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.1)]" />
      <span className="wordmark hidden whitespace-nowrap text-[15px] min-[1120px]:inline">Build With Agent</span>
    </a>
  );
}

function statusLine(status: RouterStatus | null): { led: "off" | "green" | "red" | "amber"; text: string } {
  if (!status) return { led: "off", text: "Memeriksa asisten AI…" };
  if (status.provider === "mcp") {
    if (status.reachable) return { led: "green", text: `Asisten AI siap · ${status.workers?.map((w) => agentLabel(w.name)).join(", ")}` };
    if (status.state === "error") return { led: "red", text: "BWA tidak merespons" };
    return { led: "amber", text: "Asisten AI belum terhubung" };
  }
  if (status.state === "stalled") return { led: "amber", text: "9router menyala, belum siap" };
  if (status.state === "auth") return { led: "red", text: "API key 9router ditolak" };
  if (status.state === "off") return { led: "red", text: "9router tidak berjalan" };
  if (!status.reachable) return { led: "red", text: "9router bermasalah" };
  if (!status.configured) return { led: "amber", text: "9router terhubung · pilih model" };
  return { led: "green", text: `9router · ${status.model}` };
}

/** The floating bar on every page. A project swaps the left and middle for its own name and steps. */
export function TopBar({ left, center }: { left?: ReactNode; center?: ReactNode }) {
  const { status, openSettings, openGuide } = useApp();
  const { led, text } = statusLine(status);
  const nobodyConnected = status?.provider === "mcp" && status.state === "off";
  const detail = status?.error ? [status.error, status.hint].filter(Boolean).join("\n") : text;
  return (
    <header className="topbar">
      <div className="min-w-0 justify-self-start">{left ?? <BrandPill />}</div>
      {center ?? <PageCapsule />}
      <div className="flex min-w-0 items-center gap-2 justify-self-end">
        <button
          onClick={nobodyConnected ? openGuide : openSettings}
          className="topbar-pill glass min-w-0 gap-2 px-[18px] text-[13.5px] font-semibold"
          title={detail}
          aria-label={text}
        >
          <Led state={led} />
          <span className="hidden truncate min-[1040px]:inline">{text}</span>
        </button>
        <button
          className="topbar-pill glass min-w-[46px] shrink-0 justify-center gap-2 px-3.5 text-[13.5px] font-semibold min-[1240px]:pl-3.5 min-[1240px]:pr-[18px]"
          onClick={openSettings}
          aria-label="Pengaturan"
          title="Pengaturan"
        >
          <Settings size={18} />
          <span className="hidden min-[1240px]:inline">Pengaturan</span>
        </button>
      </div>
    </header>
  );
}
