// Entry for `npm run dev` / `npm start`. The desktop app imports app.ts directly instead.
import "./env.ts";
import { startServer } from "./app.ts";

const port = Number(process.env.PORT || 3900);
const host = process.env.HOST || "127.0.0.1";

startServer({ port, host }).catch((err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${port} sudah dipakai. Tutup proses lain (atau aplikasi desktop BWA) atau set PORT=xxxx di .env.\n`);
    process.exit(1);
  }
  throw err;
});
