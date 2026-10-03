import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type EdgeTypes,
  type NodeSelectionChange,
  type NodeTypes,
} from "@xyflow/react";
import { ArrowRight, LayoutGrid, Plus, Router } from "lucide-react";
import type { Brief, NodeKind, Project, TopoNode, Topology } from "../../shared/types";
import type { AgentRunner } from "../components/AgentRun";
import { BriefDialog } from "../components/BriefDialog";
import { PathChoiceDialog } from "../components/PathChoiceDialog";
import { Segmented, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx, KIND_LABEL } from "../lib/format";
import { navigate, projectHref } from "../lib/router";
import type { RemoteChange } from "../lib/useProject";
import { prdRunStep } from "./PrdStage";
import { routeCables, type Box } from "../topology/cables";
import { CableEdge, type CableRFEdge } from "../topology/CableEdge";
import { FeatureNode, type FeatureRFNode } from "../topology/FeatureNode";
import { NodeInspector, TopologySummary } from "../topology/Inspector";
import {
  addChild,
  addLink,
  autoLayout,
  countBy,
  depthMap,
  NODE_H,
  NODE_W,
  placeMissing,
  removeLink,
  removeNodes,
  rootOf,
  updateNode,
} from "../topology/model";

interface Props {
  project: Project;
  setProject: (p: Project) => void;
  runner: AgentRunner;
  remote: RemoteChange | null;
}

const nodeTypes: NodeTypes = { feature: FeatureNode };
const edgeTypes: EdgeTypes = { cable: CableEdge };

const KIND_HEX: Record<NodeKind, string> = {
  product: "#d9632a",
  module: "#2a62cc",
  feature: "#25845a",
  integration: "#84563a",
};

export function TopologyStage(props: Props) {
  if (!props.project.topology) return null;
  return (
    <ReactFlowProvider>
      <TopologyEditor {...props} />
    </ReactFlowProvider>
  );
}

type SaveState = "saved" | "dirty" | "saving" | "error";

const topoDirection = (t: Topology | null) => (t && t.nodes.some((n) => n.x !== undefined) ? t.direction : "TB");

function TopologyEditor({ project, setProject, runner, remote }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const rf = useReactFlow<FeatureRFNode, CableRFEdge>();

  // A map that was never arranged opens in the tidy columns layout.
  const [topo, setTopo] = useState<Topology>(() => {
    const t = project.topology!;
    return placeMissing(t.nodes.some((n) => n.x !== undefined) ? t : { ...t, direction: "TB" });
  });
  const [nodes, setNodes] = useState<FeatureRFNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [briefOpen, setBriefOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [allDeps, setAllDeps] = useState(() => topoDirection(project.topology) !== "LR");

  const projectRef = useRef(project);
  projectRef.current = project;
  const latest = useRef(topo);
  latest.current = topo;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  /** JSON of the topology the server is known to hold; only real differences get saved. */
  const lastSaved = useRef(JSON.stringify(topo));
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remotePending = useRef(false);

  // ---------- persistence ----------

  const saveNow = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    const sending = latest.current;
    try {
      const res = await api.saveTopology(projectRef.current.id, sending);
      lastSaved.current = JSON.stringify(sending);
      setProject({ ...projectRef.current, topology: res.topology, updatedAt: res.updatedAt });
      setSaveState(dirty.current ? "dirty" : "saved");
    } catch (err) {
      dirty.current = true;
      setSaveState("error");
      toast(`Topologi gagal disimpan: ${(err as Error).message}`, "error");
    }
  }, [setProject, toast]);

  useEffect(() => {
    // Effects can re-run without an edit (remounts, hot reload): compare content, not identity.
    if (JSON.stringify(topo) === lastSaved.current) return;
    dirty.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), 700);
  }, [topo, saveNow]);

  useEffect(
    () => () => {
      void saveNow();
    },
    [saveNow],
  );

  // Another tab or client changed the project: adopt its topology unless we have unsaved edits.
  useEffect(() => {
    if (remote) remotePending.current = true;
  }, [remote]);
  useEffect(() => {
    if (!remotePending.current || !project.topology) return;
    remotePending.current = false;
    if (dirty.current) return;
    const adopted = placeMissing(project.topology);
    lastSaved.current = JSON.stringify(adopted);
    setTopo(adopted);
  }, [project.topology]);

  useEffect(() => {
    if (fresh.size === 0) return;
    const t = setTimeout(() => setFresh(new Set()), 9000);
    return () => clearTimeout(t);
  }, [fresh]);

  // ---------- React Flow state ----------

  /** The focused node plus everything cabled to it; the rest of the map fades back. */
  const related = useMemo(() => {
    if (!selectedId && !selectedEdgeId) return null;
    const set = new Set<string>();
    if (selectedId) {
      set.add(selectedId);
      const node = topo.nodes.find((n) => n.id === selectedId);
      if (node?.parentId) set.add(node.parentId);
      for (const n of topo.nodes) if (n.parentId === selectedId) set.add(n.id);
      for (const l of topo.links) {
        if (l.source === selectedId) set.add(l.target);
        if (l.target === selectedId) set.add(l.source);
      }
    }
    const link = selectedEdgeId ? topo.links.find((l) => l.id === selectedEdgeId) : undefined;
    if (link) {
      set.add(link.source);
      set.add(link.target);
    }
    return set;
  }, [topo, selectedId, selectedEdgeId]);

  useEffect(() => {
    const children = countBy(topo.nodes.filter((n) => n.parentId).map((n) => n.parentId!));
    const depths = depthMap(topo);
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return topo.nodes.map((n) => ({
        ...(old.get(n.id) ?? {}),
        id: n.id,
        type: "feature" as const,
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        data: {
          node: n,
          direction: topo.direction,
          depth: depths.get(n.id) ?? 0,
          childCount: children[n.id] ?? 0,
          isNew: fresh.has(n.id),
          dim: !!related && !related.has(n.id),
        },
        selected: n.id === selectedRef.current,
        deletable: n.kind !== "product",
      }));
    });
  }, [topo, fresh, related]);

  useEffect(() => {
    setNodes((nds) => nds.map((n) => (!!n.selected === (n.id === selectedId) ? n : { ...n, selected: n.id === selectedId })));
  }, [selectedId]);

  // Node boxes as rendered (live while dragging) feed the cable router.
  const boxes = useMemo(
    () =>
      new Map<string, Box>(
        nodes.map((n) => [
          n.id,
          { x: n.position.x, y: n.position.y, w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? NODE_H },
        ]),
      ),
    [nodes],
  );
  const routes = useMemo(() => routeCables(topo, boxes), [topo, boxes]);

  const edges = useMemo<CableRFEdge[]>(() => {
    const tree: CableRFEdge[] = topo.nodes
      .filter((n) => n.parentId)
      .map((n) => {
        const id = `tree:${n.id}`;
        const lit = n.id === selectedId || n.parentId === selectedId;
        return {
          id,
          type: "cable",
          source: n.parentId!,
          target: n.id,
          sourceHandle: "t-out",
          targetHandle: "t-in",
          data: { points: routes.get(id)?.points },
          selectable: false,
          deletable: false,
          focusable: false,
          style: {
            stroke: lit ? "#34414c" : "#8a96a0",
            strokeWidth: lit ? 1.8 : 1.3,
            opacity: related && !lit ? 0.22 : 1,
          },
        };
      });
    const deps: CableRFEdge[] = topo.links
      .filter((l) => allDeps || l.id === selectedEdgeId || l.source === selectedId || l.target === selectedId)
      .map((l) => {
        const route = routes.get(l.id);
        const hot = l.id === selectedEdgeId || l.source === selectedId || l.target === selectedId;
        const color = hot ? "#d9632a" : "#34414c";
        return {
          id: l.id,
          type: "cable",
          source: l.source,
          target: l.target,
          sourceHandle: route?.sourceHandle ?? "d-out",
          targetHandle: route?.targetHandle ?? "d-in-l",
          label: l.label,
          data: { points: route?.points, showLabel: hot },
          selected: l.id === selectedEdgeId,
          animated: hot,
          zIndex: hot ? 5 : 1,
          interactionWidth: 14,
          markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color },
          style: {
            stroke: color,
            strokeWidth: hot ? 2 : 1.2,
            strokeDasharray: hot ? undefined : "4 3",
            opacity: related && !hot ? 0.16 : 0.85,
          },
        };
      });
    return [...tree, ...deps];
  }, [topo, routes, related, selectedId, selectedEdgeId, allDeps]);

  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<FeatureRFNode>[]) => {
    const sel = changes.filter((c): c is NodeSelectionChange => c.type === "select");
    if (sel.length) {
      const picked = sel.find((c) => c.selected);
      if (picked) {
        setSelectedId(picked.id);
        setSelectedEdgeId(null);
      } else if (sel.some((c) => c.id === selectedRef.current)) {
        setSelectedId(null);
      }
    }
    const rest = changes.filter((c) => c.type !== "select" && c.type !== "remove");
    if (rest.length) setNodes((nds) => applyNodeChanges(rest, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<CableRFEdge>[]) => {
    for (const c of changes) {
      if (c.type === "select") {
        if (c.selected) {
          setSelectedEdgeId(c.id);
          setSelectedId(null);
        } else setSelectedEdgeId((cur) => (cur === c.id ? null : cur));
      }
      if (c.type === "remove" && !c.id.startsWith("tree:")) setTopo((t) => removeLink(t, c.id));
    }
  }, []);

  const onNodeDragStop = useCallback((_: unknown, __: FeatureRFNode, dragged: FeatureRFNode[]) => {
    const moved = new Map(dragged.map((d) => [d.id, d.position]));
    const t = latest.current;
    const changed = t.nodes.some((n) => {
      const p = moved.get(n.id);
      return p && (Math.round(p.x) !== n.x || Math.round(p.y) !== n.y);
    });
    if (!changed) return;
    setTopo({
      ...t,
      manualLayout: true,
      nodes: t.nodes.map((n) => {
        const p = moved.get(n.id);
        return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
      }),
    });
  }, []);

  const onBeforeDelete = useCallback(
    async ({ nodes: ns, edges: es }: { nodes: FeatureRFNode[]; edges: CableRFEdge[] }) => ({
      nodes: ns.filter((n) => n.data.node.kind !== "product"),
      edges: es.filter((e) => !e.id.startsWith("tree:")),
    }),
    [],
  );

  const onNodesDelete = useCallback((deleted: FeatureRFNode[]) => {
    setTopo((t) => removeNodes(t, deleted.map((d) => d.id)));
    setSelectedId(null);
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      const t = latest.current;
      const next = addLink(t, c.source, c.target);
      if (next === t) toast("Dependensi itu tidak bisa dibuat: sudah ada, atau keduanya induk dan anak.");
      else setTopo(next);
    },
    [toast],
  );

  // ---------- actions ----------

  const focusNode = (id: string) => {
    const n = latest.current.nodes.find((x) => x.id === id);
    if (n?.x === undefined || n.y === undefined) return;
    void rf.setCenter(n.x + NODE_W / 2, n.y + NODE_H / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration: 450 });
  };

  const addNode = () => {
    const parentId = selectedId ?? rootOf(topo)?.id;
    if (!parentId) return;
    const { topo: next, node } = addChild(topo, parentId);
    setTopo(next);
    selectNode(node.id);
    setTimeout(() => focusNode(node.id), 60);
  };

  const grow = async (nodeId: string | null) => {
    await saveNow();
    const target = nodeId ? topo.nodes.find((n) => n.id === nodeId) : null;
    void runner.start(
      [
        {
          agent: 2,
          label: target ? `Mengembangkan "${target.label}"` : "Mencari fitur yang belum ada di peta",
          path: `/projects/${project.id}/agents/topology/grow`,
          body: { nodeId },
        },
      ],
      {
        onDone: ([result]) => {
          const res = result as { project: Project; added: string[] };
          setProject(res.project);
          setTopo(placeMissing(res.project.topology!));
          setFresh(new Set(res.added));
          if (res.added.length) {
            setTimeout(() => void rf.fitView({ nodes: res.added.map((id) => ({ id })), duration: 500, padding: 0.6, maxZoom: 1 }), 150);
            toast(`Agent 2 menambah ${res.added.length} node. Yang baru diberi sorotan kuning.`, "success");
          } else {
            toast("Agent 2 tidak menemukan fitur baru.");
          }
        },
      },
    );
  };

  const relayout = (direction?: "LR" | "TB") => {
    if (direction) setAllDeps(direction === "TB");
    setTopo((t) => autoLayout(direction ? { ...t, direction } : t));
    setTimeout(() => void rf.fitView({ duration: 450, padding: 0.12 }), 80);
  };

  const buildTasks = async () => {
    setChoiceOpen(false);
    await saveNow();
    if (project.tasks.length) {
      const done = project.tasks.filter((t) => t.status === "done").length;
      const ok = await confirm({
        title: "Bagi ulang semua task?",
        body: `Backlog lama (${project.tasks.length} task${done ? `, ${done} sudah selesai` : ""}) akan diganti hasil baru dari Agent 3. Status centangnya ikut hilang.`,
        confirmLabel: "Bagi ulang",
        danger: done > 0,
      });
      if (!ok) return;
    }
    void runner.start(
      [{ agent: 3, label: "Memecah fitur menjadi task untuk agent coding", path: `/projects/${project.id}/agents/tasks/generate` }],
      {
        onDone: ([result]) => {
          setProject(result as Project);
          navigate(projectHref(project.id, "tasks"));
        },
      },
    );
  };

  const writePrd = async () => {
    setChoiceOpen(false);
    await saveNow();
    if (project.prd?.edited) {
      const ok = await confirm({
        title: "Tulis ulang PRD?",
        body: "PRD yang sudah kamu edit akan diganti hasil baru dari Agent 3, disusun dari topologi terbaru.",
        confirmLabel: "Tulis ulang",
        danger: true,
      });
      if (!ok) return;
    }
    void runner.start([prdRunStep(project.id)], {
      onDone: ([result]) => {
        setProject(result as Project);
        navigate(projectHref(project.id, "prd"));
      },
    });
  };

  const openStage = async (stage: "tasks" | "prd") => {
    setChoiceOpen(false);
    await saveNow();
    navigate(projectHref(project.id, stage));
  };

  const saveBrief = async (brief: Brief) => {
    const updated = await api.patchProject(project.id, { brief });
    setProject(updated);
    toast("Brief disimpan.", "success");
  };

  const selected: TopoNode | null = selectedId ? (topo.nodes.find((n) => n.id === selectedId) ?? null) : null;
  const saveLabel = { saved: "tersimpan", dirty: "belum disimpan", saving: "menyimpan…", error: "gagal simpan" }[saveState];

  return (
    <div className="relative min-h-[560px] flex-1">
      <div className="topo-canvas absolute inset-0 md:right-[320px] xl:right-[340px]">
        <ReactFlow<FeatureRFNode, CableRFEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onBeforeDelete={onBeforeDelete}
          onNodesDelete={onNodesDelete}
          onConnect={onConnect}
          onPaneClick={() => selectNode(null)}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.12}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: "#d9632a", strokeWidth: 2, strokeDasharray: "5 4" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#c1c9c5" />
          <Controls position="bottom-right" orientation="horizontal" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            style={{ marginBottom: 58, width: 170, height: 110 }}
            pannable
            zoomable
            nodeColor={(n) => KIND_HEX[(n as FeatureRFNode).data.node.kind]}
            nodeBorderRadius={4}
            maskColor="#eef1efb3"
            className="max-md:!hidden"
          />
        </ReactFlow>

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <div className="card pointer-events-auto flex flex-wrap items-center gap-1 p-1 shadow-sm">
            <button className="btn btn-ghost btn-sm" onClick={addNode} title="Tambah node di bawah node terpilih">
              <Plus size={15} /> {selected && selected.kind !== "product" ? "Sub-fitur" : "Modul"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => grow(null)} disabled={runner.busy} title="Minta Agent 2 mencari fitur yang terlewat">
              <Router size={15} /> Saran fitur
            </button>
            <span className="mx-0.5 h-5 w-px bg-rule" aria-hidden />
            <button className="btn btn-ghost btn-sm" onClick={() => relayout()} title="Susun ulang posisi semua node">
              <LayoutGrid size={15} /> Rapikan
            </button>
            <Segmented<"LR" | "TB">
              label="Arah tata letak"
              value={topo.direction}
              onChange={(d) => relayout(d)}
              options={[
                { value: "TB", label: "Kolom", title: "Modul berjajar, fitur tersusun di bawahnya" },
                { value: "LR", label: "Pohon", title: "Pohon mendatar dari kiri ke kanan" },
              ]}
            />
            <span className={cx("mono px-2 text-[10.5px]", saveState === "error" ? "text-led-red" : "text-steel")} aria-live="polite">
              {saveLabel}
            </span>
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button className="btn btn-primary shadow-sm" onClick={() => setChoiceOpen(true)} disabled={runner.busy}>
              Lanjut: pilih jalur
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        <div className="card absolute bottom-3 left-3 hidden px-3 py-2 shadow-sm sm:block">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-ink-2">
            {(Object.keys(KIND_HEX) as NodeKind[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: KIND_HEX[k] }} />
                {KIND_LABEL[k]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden>
                <line x1="0" y1="3" x2="22" y2="3" stroke="#8a96a0" strokeWidth="1.5" />
              </svg>
              struktur
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden>
                <line x1="0" y1="3" x2="22" y2="3" stroke="#34414c" strokeWidth="1.5" strokeDasharray="4 3" />
              </svg>
              dependensi
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 border-l border-rule-2 pl-3 font-semibold">
              <input type="checkbox" checked={allDeps} onChange={(e) => setAllDeps(e.target.checked)} />
              tampilkan semua dependensi
            </label>
          </div>
        </div>
      </div>

      <aside
        className={cx(
          "overflow-y-auto bg-panel",
          "md:absolute md:inset-y-0 md:right-0 md:w-[320px] md:border-l md:border-rule xl:w-[340px]",
          "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[64dvh] max-md:rounded-t-2xl max-md:border-t max-md:border-rule max-md:shadow-2xl",
          !selected && "max-md:hidden",
        )}
        aria-label={selected ? "Inspektor node" : "Ringkasan topologi"}
      >
        {selected ? (
          <NodeInspector
            key={selected.id}
            topo={topo}
            node={selected}
            busy={runner.busy}
            onChange={(patch) => setTopo((t) => updateNode(t, selected.id, patch))}
            onAddChild={addNode}
            onGrow={() => grow(selected.id)}
            onDelete={() => {
              setTopo((t) => removeNodes(t, [selected.id]));
              selectNode(null);
            }}
            onClose={() => selectNode(null)}
            onAddLink={(source, target) => setTopo((t) => addLink(t, source, target))}
            onRemoveLink={(id) => setTopo((t) => removeLink(t, id))}
            onSelect={(id) => {
              selectNode(id);
              focusNode(id);
            }}
          />
        ) : (
          <TopologySummary
            topo={topo}
            brief={project.brief}
            hasTasks={project.tasks.length > 0}
            onEditBrief={() => setBriefOpen(true)}
            onOpenTasks={() => navigate(projectHref(project.id, "tasks"))}
          />
        )}
      </aside>

      {project.brief && <BriefDialog open={briefOpen} brief={project.brief} onClose={() => setBriefOpen(false)} onSave={saveBrief} />}
      <PathChoiceDialog
        open={choiceOpen}
        project={project}
        busy={runner.busy}
        onClose={() => setChoiceOpen(false)}
        onBuildTasks={buildTasks}
        onOpenTasks={() => void openStage("tasks")}
        onWritePrd={writePrd}
        onOpenPrd={() => void openStage("prd")}
      />
    </div>
  );
}
