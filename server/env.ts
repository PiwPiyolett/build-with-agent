// Loaded first by server/index.ts so .env values exist before other modules read process.env.
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "..", ".env"));
} catch {
  // .env is optional; settings can also be configured from the UI.
}
