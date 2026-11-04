// The rules behind the screens that can be wrong without looking wrong. Pure logic, so no server is needed.
//   node --import tsx scripts/ui-logic-test.mjs

import { nextGlowSpot } from "../src/lib/glow.ts";
import { projectProgress } from "../src/lib/projectProgress.ts";
import { parseHash } from "../src/lib/router.ts";

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

// ---------- page addresses ----------

check(parseHash("").name === "home", "tanpa alamat: Halaman Utama");
check(parseHash("#/").name === "home", "alamat kosong: Halaman Utama");
check(parseHash("#/riwayat").name === "history", "#/riwayat membuka Riwayat");
check(parseHash("#/bantuan").name === "help", "#/bantuan membuka Bantuan");
check(parseHash("#/entah").name === "home", "alamat tidak dikenal kembali ke Halaman Utama");

const project = parseHash("#/p/p_123/tasks");
check(project.name === "project" && project.id === "p_123" && project.stage === "tasks", "alamat proyek tetap bekerja");

// ---------- progress on a Riwayat card ----------

const strip = (done, rest = 0) => [...Array(done).fill("done"), ...Array(rest).fill("todo")];
const line = (p) => p.steps.map((s) => `${s.label}:${s.state}`).join(" ");

let p = projectProgress({ stage: "idea", taskStrip: [] });
check(p.percent === null, "belum ada task: tidak ada persentase");
check(line(p) === "Ide:current Topologi:todo Task:todo Selesai:todo", "tahap ide");

p = projectProgress({ stage: "topology", taskStrip: [] });
check(line(p) === "Ide:done Topologi:current Task:todo Selesai:todo", "tahap topologi");

p = projectProgress({ stage: "tasks", taskStrip: strip(7, 5) });
check(p.percent === 58, "7 dari 12 task: 58%");
check(line(p) === "Ide:done Topologi:done Task:current Selesai:todo", "task masih berjalan");

p = projectProgress({ stage: "tasks", taskStrip: strip(199, 1) });
check(p.percent === 99, "199 dari 200 belum boleh terbaca 100%");

p = projectProgress({ stage: "tasks", taskStrip: ["done", "blocked", "in_progress", "todo"] });
check(p.percent === 25, "hanya task selesai yang dihitung");

p = projectProgress({ stage: "tasks", taskStrip: strip(14) });
check(p.percent === 100, "semua task selesai: 100%");
check(line(p) === "Ide:done Topologi:done Task:done Selesai:current", "semua task selesai: proyek selesai");

p = projectProgress({ stage: "tasks", taskStrip: [] });
check(p.percent === null && line(p) === "Ide:done Topologi:done Task:current Selesai:todo", "tahap task tanpa task tidak langsung selesai");

p = projectProgress({ stage: "prd", taskStrip: [] });
check(p.percent === null, "jalur PRD tanpa task: tidak ada persentase");
check(line(p) === "Ide:done Topologi:done PRD:done Selesai:current", "PRD sudah ditulis: proyek selesai");

p = projectProgress({ stage: "prd", taskStrip: strip(1, 1) });
check(p.percent === 50, "PRD ditulis setelah task dibagi: progres task tetap terlihat");

// ---------- where the moving red glow goes next ----------

// A "random" that hands out chosen numbers: 0 is the far left or top of the range, 0.5 is the middle of the screen.
const sequence = (...numbers) => {
  let i = 0;
  return () => numbers[i++ % numbers.length];
};
const near = (a, b) => Math.abs(a - b) < 0.01;

let spot = nextGlowSpot([], { width: 1000, height: 1000 }, sequence(0.5, 0.5));
check(near(spot.x, 50) && near(spot.y, 50), "tidak ada cahaya lain: titik pertama langsung dipakai");

spot = nextGlowSpot([], { width: 1000, height: 1000 }, sequence(0, 0));
check(near(spot.x, -12) && near(spot.y, -12), "batas kiri atas sedikit di luar layar");

spot = nextGlowSpot([], { width: 1000, height: 1000 }, sequence(1, 1));
check(near(spot.x, 112) && near(spot.y, 112), "batas kanan bawah sedikit di luar layar");

spot = nextGlowSpot([{ x: 50, y: 50 }], { width: 1000, height: 1000 }, sequence(0.5, 0.5, 0.9, 0.9));
check(near(spot.x, 99.6) && near(spot.y, 99.6), "terlalu dekat cahaya lain: pilih titik lain");

// On a wide window 10% across is 200px but 30% down is only 150px. The rule keeps 190px apart, so it must count pixels.
spot = nextGlowSpot([{ x: 50, y: 50 }], { width: 2000, height: 500 }, sequence(0.5806451613, 0.5));
check(near(spot.x, 60), "jarak dihitung dalam piksel: geser 200px mendatar sudah cukup jauh");

spot = nextGlowSpot([{ x: 50, y: 50 }], { width: 2000, height: 500 }, sequence(0.5, 0.7419354839, 0.9, 0.9));
check(near(spot.x, 99.6), "jarak dihitung dalam piksel: geser 150px menurun masih terlalu dekat");

spot = nextGlowSpot([{ x: 50, y: 50 }], { width: 1000, height: 1000 }, sequence(0.5, 0.5));
check(near(spot.x, 50), "tidak ada titik yang cukup jauh: tetap bergerak, tidak macet");

console.log(failures ? `\n${failures} gagal` : "\nsemua lolos");
process.exit(failures ? 1 : 0);
