// Shared data model used by the server, the web UI, and (as JSON) the agent bridge.

export type Stage = "idea" | "topology" | "tasks" | "prd";

// ---------- Agent 1: idea exploration ----------

export interface IdeaOption {
  id: string;
  label: string;
  detail?: string;
  custom?: boolean;
}

export interface IdeaDimension {
  id: string;
  label: string;
  question: string;
  multi: boolean;
  options: IdeaOption[];
}

export interface IdeaDirection {
  id: string;
  title: string;
  pitch: string;
  why?: string;
  custom?: boolean;
}

export interface IdeaExploration {
  title: string;
  tagline: string;
  summary: string;
  problem: string;
  directions: IdeaDirection[];
  dimensions: IdeaDimension[];
}

export interface Selections {
  directionId: string | null;
  /** dimensionId -> selected option ids */
  choices: Record<string, string[]>;
  notes: string;
}

export interface Brief {
  name: string;
  oneLiner: string;
  problem: string;
  solution: string;
  targetUsers: string[];
  platforms: string[];
  coreValue: string;
  keyCapabilities: string[];
  monetization: string;
  techStack: string[];
  mvpScope: string;
  constraints: string[];
}

// ---------- Agent 2: feature topology ----------

export type NodeKind = "product" | "module" | "feature" | "integration";
export type Priority = "must" | "should" | "could";

export interface TopoNode {
  id: string;
  label: string;
  kind: NodeKind;
  description: string;
  parentId: string | null;
  priority: Priority;
  /** 1 (trivial) .. 5 (very complex) */
  complexity: number;
  x?: number;
  y?: number;
}

/** Cross-dependency: `source` must exist before `target` can work. */
export interface TopoLink {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Topology {
  nodes: TopoNode[];
  links: TopoLink[];
  direction: "LR" | "TB";
  /** true once the user has dragged nodes; auto layout then only runs on request */
  manualLayout: boolean;
}

// ---------- Agent 3: tasks ----------

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "high" | "medium" | "low";

export type TaskLogKind =
  | "create"
  | "claim"
  | "note"
  | "complete"
  | "block"
  | "release"
  | "reopen"
  | "edit";

export interface TaskLogEntry {
  at: string;
  by: string;
  kind: TaskLogKind;
  text?: string;
}

export interface TaskCompletion {
  summary: string;
  files: string[];
  by: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  phaseId: string | null;
  featureIds: string[];
  type: string;
  priority: TaskPriority;
  estimate: string;
  dependsOn: string[];
  acceptance: string[];
  agentHint: string;
  status: TaskStatus;
  assignee: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  completion: TaskCompletion | null;
  log: TaskLogEntry[];
  order: number;
}

export interface Phase {
  id: string;
  name: string;
  goal: string;
}

export interface ActivityEntry {
  at: string;
  by: string;
  text: string;
  taskId?: string;
}

// ---------- Agent 3, PRD mode: a shareable Product Requirements Document ----------

export interface PrdDoc {
  markdown: string;
  generatedAt: string;
  updatedAt: string;
  /** true once the user edited the generated text */
  edited: boolean;
  model: string;
}

export interface Project {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  stage: Stage;
  idea: IdeaExploration | null;
  selections: Selections;
  brief: Brief | null;
  topology: Topology | null;
  phases: Phase[];
  tasks: Task[];
  prd: PrdDoc | null;
  activity: ActivityEntry[];
}

export type TaskCounts = Record<TaskStatus, number>;

export interface ProjectSummary {
  id: string;
  name: string;
  prompt: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  taskCounts: TaskCounts;
  /** task statuses in plan order, for the LED strip */
  taskStrip: TaskStatus[];
}

// ---------- AI brain settings (9router or an MCP agent) ----------

export type AgentKey = "idea" | "topology" | "tasks";

/** "9router" = OpenAI-compatible HTTP; "mcp" = a standby MCP client (Claude Code, Codex) answers queued jobs */
export type BrainProvider = "9router" | "mcp";

/** mcp mode: once Agent 3 has split the tasks, the brain session reports and waits, or starts coding right away */
export type HandoverMode = "wait" | "auto";

export interface PublicSettings {
  /** false in the public build: MCP agents are the only brain and 9router stays out of the UI */
  routerEnabled: boolean;
  provider: BrainProvider;
  handover: HandoverMode;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyPreview: string;
  model: string;
  agentModels: Record<AgentKey, string>;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
}

/** "Sambungkan otomatis": whether BWA is registered as an MCP server in a coding agent on this machine. */
export interface AgentConnection {
  agent: "claude" | "codex";
  /** the agent (CLI or config folder) was found on this machine */
  found: boolean;
  /** outdated = registered, but pointing at another BWA install or bridge path */
  state: "connected" | "outdated" | "disconnected";
  /** where BWA looked: the claude executable, or Codex's config.toml */
  detail: string;
  /** Claude Code only: the /bwa command is installed and current */
  skill?: boolean;
  /** what "Sambungkan" will change, shown before the user agrees */
  changes: string[];
  message?: string;
}

/** An MCP client that recently long-polled for brain jobs. */
export interface BrainWorker {
  name: string;
  lastSeen: string;
  /** jobs it claimed and has not answered yet */
  busy: number;
}

export interface RouterStatus {
  provider: BrainProvider;
  /**
   * 9router: ok = /v1 answers; off = not running; stalled = running but /v1 hangs; auth = key rejected.
   * mcp: ok = at least one agent is standby; off = none.
   */
  state: "ok" | "off" | "stalled" | "auth" | "error";
  reachable: boolean;
  configured: boolean;
  /** 9router model id, or the standby agent names in mcp mode */
  model: string;
  modelCount: number;
  /** mcp mode only */
  workers?: BrainWorker[];
  /** mcp mode only: jobs waiting for an agent */
  pending?: number;
  error?: string;
  hint?: string;
}

// ---------- streaming agent events (NDJSON) ----------

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "progress"; chars: number; reasoningChars: number }
  | { type: "done"; result: unknown }
  | { type: "error"; message: string; hint?: string };
