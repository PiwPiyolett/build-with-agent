import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, Copy, X } from "lucide-react";
import type { TaskStatus } from "../../shared/types";
import { cx, STATUS_META } from "../lib/format";

// ---------- motion helpers ----------

/** How long something stays on screen after it is told to close, matching the leaving animations in index.css. */
const LEAVE_MS = 180;

/** Keeps something rendered for a moment after it closes, so it can animate out instead of vanishing. */
function usePresence(open: boolean) {
  const [rendered, setRendered] = useState(open);
  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const t = setTimeout(() => setRendered(false), LEAVE_MS);
    return () => clearTimeout(t);
  }, [open]);
  return { rendered: open || rendered, closing: !open && rendered };
}

/** Moves a white thumb under whichever child matches `selector`, sliding between them when `value` changes. */
export function useSlidingThumb(box: RefObject<HTMLElement | null>, thumb: RefObject<HTMLElement | null>, selector: string, value: unknown) {
  useLayoutEffect(() => {
    const place = () => {
      const target = box.current?.querySelector<HTMLElement>(selector);
      const el = thumb.current;
      if (!el) return;
      el.style.opacity = target ? "1" : "0";
      // Hidden for now, such as in a closed section: the observer below calls again once it shows.
      if (!target?.offsetWidth) return;
      // The first placement must not slide in from the corner, only later changes should.
      const first = !el.style.width;
      if (first) el.style.transition = "none";
      el.style.width = `${target.offsetWidth}px`;
      el.style.height = `${target.offsetHeight}px`;
      el.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
      if (first) {
        void el.offsetWidth;
        el.style.transition = "";
      }
    };
    place();
    void document.fonts.ready.then(place);
    const observer = new ResizeObserver(place);
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, [box, thumb, selector, value]);
}

// ---------- LEDs ----------

export function Led({ state, large, label }: { state: "off" | "amber" | "green" | "red"; large?: boolean; label?: string }) {
  return (
    <span
      className={cx("led", state !== "off" && `led-${state}`, large && "led-lg")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function StatusLed({ status, large }: { status: TaskStatus; large?: boolean }) {
  const state = status === "done" ? "green" : status === "in_progress" ? "amber" : status === "blocked" ? "red" : "off";
  return <Led state={state} large={large} label={STATUS_META[status].label} />;
}

export function LedStrip({
  statuses,
  large,
  onPick,
  labels,
}: {
  statuses: TaskStatus[];
  large?: boolean;
  onPick?: (index: number) => void;
  labels?: string[];
}) {
  if (statuses.length === 0) return null;
  return (
    <div className={cx("led-strip", large && "led-strip-lg")} aria-label="Status task">
      {statuses.map((s, i) =>
        onPick ? (
          <span
            key={i}
            data-s={s}
            role="button"
            tabIndex={0}
            title={labels?.[i]}
            onClick={() => onPick(i)}
            onKeyDown={(e) => e.key === "Enter" && onPick(i)}
          />
        ) : (
          <span key={i} data-s={s} title={labels?.[i]} />
        ),
      )}
    </div>
  );
}

// ---------- modal ----------

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "max-w-xl",
  flush,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** the content lays out its own padding and scrolling, as Settings does for its side menu */
  flush?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { rendered, closing } = usePresence(open);
  // While it animates out it keeps showing what it last showed, even if its owner has already cleared that.
  const shown = useRef({ title, eyebrow, children, footer });
  if (open) shown.current = { title, eyebrow, children, footer };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    // Start on the first visible field. Otherwise the dialog itself takes focus, so the close button is not lit up on opening.
    setTimeout(() => {
      const fields = panel.current?.querySelectorAll<HTMLElement>("input, textarea, select");
      const first = [...(fields ?? [])].find((el) => el.offsetParent !== null);
      (first ?? panel.current)?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!rendered) return null;
  return (
    <div
      className={cx("modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4", closing && "is-leaving")}
      onMouseDown={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx("modal-panel card flex max-h-[92dvh] w-full flex-col rounded-b-none shadow-2xl outline-none sm:rounded-b-[18px]", width, closing && "is-leaving")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule-2 px-5 pb-3 pt-4">
          <div>
            {shown.current.eyebrow && <div className="eyebrow mb-1">{shown.current.eyebrow}</div>}
            <h2 className="display text-[19px] leading-tight">{shown.current.title}</h2>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon -mr-2" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </div>
        <div className={flush ? "min-h-0" : "overflow-y-auto px-5 py-4"}>{shown.current.children}</div>
        {shown.current.footer && <div className="flex justify-end gap-2 border-t border-rule-2 px-5 py-3">{shown.current.footer}</div>}
      </div>
    </div>
  );
}

// ---------- confirm ----------

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(req: Omit<ConfirmRequest, "resolve">) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (r: Omit<ConfirmRequest, "resolve">) => new Promise<boolean>((resolve) => setReq({ ...r, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!req}
        onClose={() => close(false)}
        title={req?.title ?? ""}
        width="max-w-md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => close(false)}>
              Batal
            </button>
            <button className={cx("btn", req?.danger ? "btn-danger" : "btn-primary")} onClick={() => close(true)}>
              {req?.confirmLabel}
            </button>
          </>
        }
      >
        <p className="whitespace-pre-line text-[14.5px] text-ink-2 [overflow-wrap:anywhere]">{req?.body}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------- toasts ----------

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
  leaving?: boolean;
}

const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    const stay = tone === "error" ? 7000 : 3500;
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), stay);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), stay + LEAVE_MS);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "toast pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl bg-ink px-3.5 py-2.5 text-[13.5px] text-paper shadow-lg",
              t.leaving && "is-leaving",
            )}
          >
            <Led state={t.tone === "error" ? "red" : t.tone === "success" ? "green" : "amber"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- small pieces ----------

export function CopyButton({ text, label = "Salin" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Tersalin" : label}
    </button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {label ? <span className="text-[13px] font-semibold text-ink-2">{label}</span> : <span />}
        <CopyButton text={code} />
      </div>
      <pre className="code-block">{code}</pre>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingThumb(box, thumb, 'button[aria-pressed="true"]', value);
  return (
    <div ref={box} className="seg" role="group" aria-label={label}>
      <span ref={thumb} className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ message, hint, action }: { message: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-led-red/40 bg-led-red/5 px-3.5 py-3 text-[13.5px]">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5">
          <Led state="red" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{message}</div>
          {hint && <div className="mt-0.5 break-words text-ink-2">{hint}</div>}
          {action && <div className="mt-2.5">{action}</div>}
        </div>
      </div>
    </div>
  );
}
