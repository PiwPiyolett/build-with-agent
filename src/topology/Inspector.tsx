import { useMemo, useState } from "react";
import { ArrowRight, Plus, Router, Trash2, X } from "lucide-react";
import type { Brief, NodeKind, Priority, TopoNode, Topology } from "../../shared/types";
import { Segmented } from "../components/ui";
import { COMPLEXITY_LABEL, cx, KIND_LABEL, PRIORITY_META } from "../lib/format";
import { KIND_ICON } from "./FeatureNode";
import { countBy, descendantIds } from "./model";

interface NodeInspectorProps {
  topo: Topology;
  node: TopoNode;
  busy: boolean;
  onChange: (patch: Partial<TopoNode>) => void;
  onAddChild: () => void;
  onGrow: () => void;
  onDelete: () => void;
  onClose: () => void;
  onAddLink: (source: string, target: string) => void;
  onRemoveLink: (id: string) => void;
  onSelect: (id: string) => void;
}

export function NodeInspector({
  topo,
  node,
  busy,
  onChange,
  onAddChild,
  onGrow,
  onDelete,
  onClose,
  onAddLink,
  onRemoveLink,
  onSelect,
}: NodeInspectorProps) {
  const [linkPick, setLinkPick] = useState("");
  const byId = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes]);
  const blockedParents = useMemo(() => descendantIds(topo, node.id).add(node.id), [topo, node.id]);
  const needs = topo.links.filter((l) => l.target === node.id);
  const neededBy = topo.links.filter((l) => l.source === node.id);
  const linkable = topo.nodes.filter(
    (n) =>
      n.id !== node.id &&
      n.kind !== "product" &&
      n.id !== node.parentId &&
      n.parentId !== node.id &&
      !needs.some((l) => l.source === n.id),
  );
  const Icon = KIND_ICON[node.kind];
  const isRoot = node.kind === "product";

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center gap-2">
        <span className={cx("kind-badge", `kind-${node.kind}`)} style={{ background: kindColor(node.kind) }}>
          <Icon size={12} strokeWidth={2.4} />
        </span>
        <span className="eyebrow">{KIND_LABEL[node.kind]}</span>
        <span className="mono ml-1 truncate text-[10px] text-mute">{node.id}</span>
        <button className="btn btn-ghost btn-sm btn-icon ml-auto" onClick={onClose} aria-label="Tutup inspektor">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="node-label">
            Nama
          </label>
          <input
            id="node-label"
            className="field text-[15px] font-semibold"
            value={node.label}
            maxLength={80}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="node-desc">
            Deskripsi
          </label>
          <textarea
            id="node-desc"
            className="field min-h-[76px] resize-y text-[13.5px]"
            value={node.description}
            maxLength={400}
            placeholder="Apa yang dilakukan fitur ini untuk pengguna?"
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
      </div>

      {!isRoot && (
        <div className="space-y-3.5">
          <div>
            <span className="label">Jenis</span>
            <Segmented<NodeKind>
              label="Jenis node"
              value={node.kind}
              onChange={(kind) => onChange({ kind })}
              options={(["module", "feature", "integration"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </div>
          <div>
            <span className="label">Prioritas</span>
            <Segmented<Priority>
              label="Prioritas"
              value={node.priority}
              onChange={(priority) => onChange({ priority })}
              options={(["must", "should", "could"] as const).map((p) => ({
                value: p,
                label: PRIORITY_META[p].label,
                title: PRIORITY_META[p].hint,
              }))}
            />
            <p className="mt-1.5 text-[12px] text-steel">{PRIORITY_META[node.priority].hint}.</p>
          </div>
          <div>
            <span className="label">Kompleksitas</span>
            <div className="flex items-center gap-3">
              <div className="flex gap-1" role="radiogroup" aria-label="Kompleksitas">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={node.complexity === i}
                    aria-label={`${i}: ${COMPLEXITY_LABEL[i]}`}
                    onClick={() => onChange({ complexity: i })}
                    className={cx(
                      "h-5 w-7 rounded-[4px] border transition-colors",
                      i <= node.complexity ? "border-steel bg-steel" : "border-rule bg-panel hover:border-steel",
                    )}
                  />
                ))}
              </div>
              <span className="text-[13px] text-ink-2">{COMPLEXITY_LABEL[node.complexity]}</span>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="node-parent">
              Induk
            </label>
            <select
              id="node-parent"
              className="field"
              value={node.parentId ?? ""}
              onChange={(e) => onChange({ parentId: e.target.value })}
            >
              {topo.nodes
                .filter((n) => !blockedParents.has(n.id) && n.kind !== "integration")
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {KIND_LABEL[n.kind]} · {n.label}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {!isRoot && (
        <div>
          <div className="label">Dependensi</div>
          <div className="space-y-3 rounded-lg border border-rule-2 p-3">
            <LinkList
              title="Butuh"
              empty="Tidak butuh fitur lain."
              items={needs.map((l) => ({ id: l.id, node: byId.get(l.source), label: l.label }))}
              onRemove={onRemoveLink}
              onSelect={onSelect}
            />
            <LinkList
              title="Dibutuhkan oleh"
              empty="Belum ada fitur yang bergantung padanya."
              items={neededBy.map((l) => ({ id: l.id, node: byId.get(l.target), label: l.label }))}
              onRemove={onRemoveLink}
              onSelect={onSelect}
            />
            <div className="flex gap-2 border-t border-rule-2 pt-3">
              <select className="field text-[13px]" value={linkPick} onChange={(e) => setLinkPick(e.target.value)} aria-label="Tambah fitur yang dibutuhkan">
                <option value="">Tambah yang dibutuhkan…</option>
                {linkable.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm h-[38px] shrink-0"
                disabled={!linkPick}
                onClick={() => {
                  onAddLink(linkPick, node.id);
                  setLinkPick("");
                }}
              >
                Tambah
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <button className="btn btn-secondary justify-start" onClick={onAddChild}>
          <Plus size={16} /> Tambah {isRoot ? "modul" : "sub-fitur"} manual
        </button>
        <button className="btn btn-secondary justify-start" onClick={onGrow} disabled={busy}>
          <Router size={16} /> Kembangkan dengan Agent 2
        </button>
        {!isRoot && (
          <button className="btn btn-danger justify-start" onClick={onDelete}>
            <Trash2 size={16} /> Hapus node
          </button>
        )}
      </div>
    </div>
  );
}

function kindColor(kind: NodeKind) {
  return {
    product: "var(--color-pair-orange)",
    module: "var(--color-pair-blue)",
    feature: "var(--color-pair-green)",
    integration: "var(--color-pair-brown)",
  }[kind];
}

function LinkList({
  title,
  empty,
  items,
  onRemove,
  onSelect,
}: {
  title: string;
  empty: string;
  items: { id: string; node?: TopoNode; label?: string }[];
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{title}</div>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-mute">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <button
                className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink hover:underline"
                onClick={() => item.node && onSelect(item.node.id)}
              >
                {item.node?.label ?? "?"}
                {item.label && <span className="font-normal text-steel"> · {item.label}</span>}
              </button>
              <button className="btn btn-ghost btn-sm btn-icon h-6 w-6" onClick={() => onRemove(item.id)} aria-label="Hapus dependensi">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopologySummary({
  topo,
  brief,
  hasTasks,
  onEditBrief,
  onOpenTasks,
}: {
  topo: Topology;
  brief: Brief | null;
  hasTasks: boolean;
  onEditBrief: () => void;
  onOpenTasks: () => void;
}) {
  const kinds = countBy(topo.nodes.map((n) => n.kind));
  const prios = countBy(topo.nodes.filter((n) => n.kind === "feature" || n.kind === "integration").map((n) => n.priority));
  return (
    <div className="flex flex-col gap-5 p-4">
      {brief && (
        <div>
          <div className="flex items-center justify-between">
            <span className="eyebrow">Brief · Agent 1</span>
            <button className="btn btn-ghost btn-sm -mr-2" onClick={onEditBrief}>
              Edit brief
            </button>
          </div>
          <h3 className="display mt-1 text-[19px] leading-tight">{brief.name}</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{brief.oneLiner}</p>
          {brief.techStack.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brief.techStack.map((t) => (
                <span key={t} className="tag normal-case tracking-normal">
                  {t}
                </span>
              ))}
            </div>
          )}
          {brief.mvpScope && <p className="mt-3 text-[12.5px] leading-relaxed text-steel">{brief.mvpScope}</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-rule-2 pt-4 text-center">
        {(["module", "feature", "integration"] as const).map((k) => (
          <div key={k} className="rounded-lg bg-wash py-2.5">
            <div className="display text-[22px] leading-none">{kinds[k] ?? 0}</div>
            <div className="mt-1 text-[11.5px] text-steel">{KIND_LABEL[k]}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["must", "should", "could"] as const).map((p) => (
          <span key={p} className={cx("tag", p === "must" && "tag-ink", p === "could" && "tag-dashed")}>
            {PRIORITY_META[p].short} · {prios[p] ?? 0}
          </span>
        ))}
        <span className="tag">Dependensi · {topo.links.length}</span>
      </div>

      <ul className="space-y-2 border-t border-rule-2 pt-4 text-[13px] leading-snug text-ink-2">
        <li>Klik node untuk mengubah nama, prioritas, induk, atau dependensinya.</li>
        <li>Tarik dari port kanan sebuah node ke port kiri node lain untuk membuat dependensi.</li>
        <li>
          Pilih node atau garis putus-putus lalu tekan <span className="kbd">Delete</span> untuk menghapus.
        </li>
      </ul>

      {hasTasks && (
        <button className="btn btn-secondary justify-between" onClick={onOpenTasks}>
          Lihat task <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
