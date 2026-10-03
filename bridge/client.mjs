// Tiny HTTP client for the BWA agent API, shared by the MCP server and the CLI.
// Talks to the running BWA server (default http://127.0.0.1:3900).

export const BWA_URL = (process.env.BWA_URL || "http://127.0.0.1:3900").replace(/\/+$/, "");

export class BwaError extends Error {}

export async function call(method, path, body, agent = "agent", timeoutMs = 20_000) {
  let res;
  try {
    res = await fetch(`${BWA_URL}/api/agent${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-bwa-client": `agent:${agent}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BwaError(
      `BWA tidak bisa dihubungi di ${BWA_URL}. Buka aplikasi Build With Agent ` +
        `(atau jalankan "npm run dev" untuk versi web). Detail: ${err?.cause?.code || err?.message}`,
    );
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    throw new BwaError(`${data.error || `HTTP ${res.status}`}${data.hint ? `\nPetunjuk: ${data.hint}` : ""}`);
  }
  return data;
}

/** Explicit id → BWA_PROJECT_ID → the only project (preferring ones that already have tasks). */
export async function resolveProjectId(explicit) {
  const id = String(explicit || process.env.BWA_PROJECT_ID || "").trim();
  if (id) return id;
  const { projects } = await call("GET", "/projects");
  const withTasks = projects.filter((p) => Object.values(p.taskCounts).some((n) => n > 0));
  const pool = withTasks.length ? withTasks : projects;
  if (pool.length === 1) return pool[0].id;
  if (pool.length === 0) throw new BwaError("Belum ada proyek di BWA. Buat proyek dan bagi task dulu dari UI.");
  throw new BwaError(
    `Ada ${pool.length} proyek. Sebutkan project_id (atau set BWA_PROJECT_ID):\n` +
      pool.map((p) => `- ${p.id} · ${p.name}`).join("\n"),
  );
}

export function withWarnings(result) {
  const warnings = result.warnings?.length ? `\n\n⚠ ${result.warnings.join("\n⚠ ")}` : "";
  return `${result.markdown}${warnings}`;
}
