import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = process.env.PORT || "3900";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
    // Build outputs and project data are not source. Watching them on Windows also locks
    // freshly created folders, which breaks the desktop installer build.
    watch: { ignored: ["**/release/**", "**/dist-electron/**", "**/dist/**", "**/data/**"] },
  },
});
