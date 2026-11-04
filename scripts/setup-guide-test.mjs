// Which step of the "Hubungkan asisten AI" guide is someone on? Pure logic, so no server is needed.
//   node --import tsx scripts/setup-guide-test.mjs

import { agentLabel, guideProgress, suggestAgent } from "../shared/setupGuide.ts";

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

const claude = (over = {}) => ({ agent: "claude", found: false, state: "disconnected", detail: "", changes: [], ...over });
const codex = (over = {}) => ({ agent: "codex", found: false, state: "disconnected", detail: "", changes: [], signedIn: null, ...over });
const worker = (name) => ({ name, lastSeen: "2026-11-04T00:00:00.000Z", busy: 0 });
const states = (p) => [p.steps.install, p.steps.signin, p.steps.connect, p.steps.start].join(" ");

// ---------- installing ----------

let p = guideProgress(claude(), []);
check(p.current === "install" && states(p) === "current todo todo todo", "belum ada apa-apa: mulai dari memasang");

p = guideProgress(claude({ appFound: true }), []);
check(p.current === "signin", "aplikasi Claude sudah ada: lanjut ke masuk akun");

p = guideProgress(codex(), [], { install: true });
check(p.current === "signin", "Codex tidak bisa dicek otomatis, jadi guru bisa menekan Sudah");

p = guideProgress(codex({ found: true, via: "app" }), []);
check(p.current === "signin", "folder Codex ditemukan: langkah memasang selesai");

// ---------- signing in ----------

p = guideProgress(claude({ found: true, via: "app", signedIn: null }), []);
check(p.current === "signin" && !p.needsCodeTab, "login aplikasi tidak bisa dipastikan: guru diminta menjawab");

p = guideProgress(claude({ found: true, via: "app", signedIn: null }), [], { signin: true });
check(p.current === "connect", "guru menekan Sudah: lanjut ke menghubungkan");

p = guideProgress(claude({ found: true, via: "cli", signedIn: true }), []);
check(p.current === "connect", "login terminal terbaca: tidak perlu menjawab");

p = guideProgress(claude({ found: true, via: "cli", signedIn: false }), [], { signin: true });
check(p.current === "signin", "login terminal jelas belum: Sudah tidak bisa melewatinya");

p = guideProgress(claude({ appFound: true }), [], { signin: true });
check(p.current === "signin" && p.needsCodeTab, "aplikasi terpasang, tapi Claude Code di dalamnya belum ada: minta buka tab Code");

// ---------- connecting ----------

p = guideProgress(claude({ found: true, signedIn: true, state: "outdated" }), []);
check(p.current === "connect" && p.needsUpdate, "sambungan lama: perlu diperbarui");

p = guideProgress(claude({ found: true, signedIn: true, state: "connected", skill: false }), []);
check(p.current === "connect" && p.needsUpdate, "perintah pendek hilang: perlu diperbarui");

p = guideProgress(claude({ found: true, signedIn: true, state: "disconnected" }), []);
check(p.current === "connect" && !p.needsUpdate, "belum pernah terhubung: bukan pembaruan");

// ---------- starting ----------

const connected = claude({ found: true, via: "app", signedIn: null, state: "connected", skill: true });

p = guideProgress(connected, [], { signin: true });
check(p.current === "start" && !p.ready && states(p) === "done done done current", "sudah terhubung: tinggal mulai percakapan");

p = guideProgress(connected, []);
check(p.current === "start", "sudah pernah terhubung: tidak ditanya lagi soal masuk akun");

p = guideProgress(connected, [worker("claude-code")]);
check(p.ready && p.current === null && states(p) === "done done done done", "asisten menjawab: semua langkah selesai walau login tidak bisa dipastikan");

p = guideProgress(connected, [worker("codex")], { signin: true });
check(!p.ready && p.current === "start", "Codex yang siap tidak menyelesaikan langkah Claude");

p = guideProgress(codex({ found: true, state: "connected", skill: true }), [worker("codex")]);
check(p.ready, "Codex yang siap menyelesaikan langkah Codex");

// ---------- which agent to show first ----------

const none = { claude: claude(), codex: codex() };
check(suggestAgent(none, []) === "claude", "tidak ada petunjuk: tampilkan Claude");
check(suggestAgent({ claude: claude(), codex: codex({ found: true }) }, []) === "codex", "hanya Codex yang terpasang: tampilkan Codex");
check(suggestAgent({ claude: claude({ appFound: true }), codex: codex({ found: true }) }, []) === "claude", "keduanya terpasang: tampilkan Claude");
check(suggestAgent({ claude: claude({ found: true }), codex: codex({ state: "connected" }) }, []) === "codex", "yang sudah terhubung didahulukan");
check(suggestAgent({ claude: claude({ state: "connected" }), codex: codex() }, [worker("codex")]) === "codex", "yang sedang siap paling didahulukan");

// ---------- names people see ----------

check(agentLabel("claude-code") === "Claude", "claude-code tampil sebagai Claude");
check(agentLabel("codex") === "Codex", "codex tampil sebagai Codex");
check(agentLabel("cursor") === "cursor", "agent lain tampil apa adanya");

console.log(failures ? `\n${failures} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exit(failures ? 1 : 0);
