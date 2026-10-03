# Build With Agent (BWA)

[English](README.md) · **Bahasa Indonesia**

Dari satu kalimat ide ke task yang dikerjakan dan dicentang agent coding, atau ke PRD yang siap dibagikan.

BWA menjalankan tiga agent AI. Otaknya adalah agent coding yang sudah kamu pakai, yaitu **Claude Code atau Codex**, yang tersambung lewat MCP dan memakai langganan atau modelnya sendiri. Tidak perlu API key.

1. **Agent 1 · Pengembang Ide**: mengubah ide mentah menjadi arah pengembangan dan kelompok pilihan yang bisa diklik (pengguna, platform, fitur, stack, cakupan MVP), lalu merangkum pilihanmu menjadi brief proyek.
2. **Agent 2 · Arsitek Fitur**: memetakan brief menjadi topologi fitur (produk → modul → fitur, integrasi, dependensi) yang bisa diedit seperti diagram jaringan.
3. **Agent 3**: setelah topologi siap, pilih jalurnya:
   - **Kerjakan dengan agent coding**: Agent 3 membagi fitur menjadi task berurutan. Claude Code, Codex, Cursor, dan agent lain mengambilnya lewat MCP, mengerjakannya di repository-mu, lalu mencentangnya di BWA secara langsung.
   - **Jadikan PRD (.md)**: Product Requirements Document lengkap untuk tim, klien, dosen, atau investor.

```
Sesi Claude Code, dibuka di folder proyekmu → /bwa
  │ Ide dan Topologi: kamu bekerja di BWA, sesi itu menjawab tiap langkah di latar
  ▼
"Bagi jadi task" → task terbentuk
  ▼
Serah-terima: sesi yang sama menjadi agent coding proyek itu
  ├─ "Tunggu perintahku": meringkas rencana, lalu bertanya "Mulai dari T01?"
  └─ "Langsung kerjakan": mengambil, mengerjakan, dan mencentang task satu per satu
```

## Pasang

Unduh installer untuk sistemmu dari [Releases](https://github.com/PiwPiyolett/build-with-agent/releases):

| Sistem | File | Saat pertama dibuka |
| --- | --- | --- |
| Windows | `BWA-Setup-<versi>.exe` | SmartScreen bisa memperingatkan karena installer tidak bertanda tangan: **More info → Run anyway** |
| macOS (Apple Silicon / Intel) | `BWA-<versi>-mac-arm64.dmg` / `-mac-x64.dmg` | Aplikasi tidak bertanda tangan. Kalau macOS bilang aplikasinya rusak atau tidak bisa dibuka, jalankan `xattr -cr "/Applications/Build With Agent.app"` |
| Linux | `BWA-<versi>-linux-x86_64.AppImage` | `chmod +x BWA-*.AppImage`, lalu jalankan |

Setiap build dinyalakan di Windows, macOS, dan Linux di CI untuk memastikan aplikasinya berjalan dan menyajikan UI. Build macOS dan Linux belum dicoba di perangkat pribadi, jadi laporan sangat diterima.

Aplikasi tetap berjalan di tray saat jendelanya ditutup, supaya agent tetap bisa menjawab dan mencentang task. Proyek dan pengaturan tersimpan di folder data aplikasi (Windows `%APPDATA%\Build With Agent\data`, macOS `~/Library/Application Support/Build With Agent/data`, Linux `~/.config/Build With Agent/data`).

## Sambungkan Claude Code atau Codex

### Cara A: satu klik di BWA (disarankan)

Buka **Pengaturan** (lampu status di kanan atas) → **Sambungkan agent**, lalu klik **Sambungkan** pada Claude Code dan/atau Codex. BWA menampilkan dulu apa saja yang akan diubah:

- **Claude Code**: menjalankan `claude mcp add bwa --scope user …` dan memasang perintah `/bwa`. BWA juga menemukan `claude` bawaan aplikasi desktop Claude, walaupun tidak ada di PATH.
- **Codex**: menulis bagian `[mcp_servers.bwa]` di `~/.codex/config.toml`. Isi lain file itu tidak disentuh, dan versi sebelumnya disimpan sebagai `config.toml.bak-bwa`.

Kalau BWA dipindah atau dipasang ulang, kartunya berubah kuning ("menunjuk ke lokasi BWA lain") dan **Perbarui** membereskannya. **Hapus koneksi** mencabut pendaftaran BWA dari agent itu. Tombol ini *bukan* untuk menghentikan mode otak: untuk itu cukup tekan Esc di sesi agent. Perintah manualnya ada di **Cara manual**, di bawah kartu.

### Cara B: plugin Claude Code

Di Claude Code:

```
/plugin marketplace add PiwPiyolett/build-with-agent
/plugin install bwa@build-with-agent
```

Plugin ini menambahkan `/bwa:start`. Saat pertama kali dijalankan dan BWA sedang menyala, perintah ini mendaftarkan MCP server `bwa` sendiri. Setelah itu buka sesi baru dan jalankan lagi.

## Cara pakai

1. Buka **sesi baru** agent di **folder repository proyekmu** (tempat kodenya akan ditulis).
2. Claude Code: ketik `/bwa` (atau `/bwa:start` dari plugin). Codex: kirim prompt "jadi otak" dari Pengaturan BWA.
3. Lampu di BWA berubah hijau ("Agent MCP · claude-code"). Kerjakan Ide dan Topologi di BWA, dan biarkan sesinya tetap terbuka.
4. Pilih apa yang terjadi setelah task terbentuk, di dialog **Mau diapakan idenya?** (di atas tombol "Bagi jadi task") atau di Pengaturan:

| Mode | Yang dilakukan sesi agent |
| --- | --- |
| Tunggu perintahku (default) | Meringkas proyek (fase, jumlah task, task pertama), bertanya "Mulai dari T01?", lalu menunggu jawabanmu |
| Langsung kerjakan | Meringkas singkat, lalu mengambil, mengerjakan, dan mencentang task sampai habis. Kamu tetap bisa menyela lewat chat |

Untuk melanjutkan proyek di sesi baru, ketik `/bwa task` (atau `/bwa task p_xxxx`).

Perlu diketahui:

- Kalau tidak ada agent yang standby selama sekitar 45 detik, run berhenti dengan petunjuk. Job tersimpan di memori, jadi ikut hilang saat BWA ditutup.
- Timeout di Pengaturan membatasi lama agent menjawab satu job setelah mengambilnya. Waktu menunggu di antrean tidak dihitung.
- Satu sesi mengerjakan satu job dalam satu waktu. PRD terdiri dari dua job, jadi lebih cepat kalau ada dua sesi yang standby.
- Kualitas dan kecepatan ditentukan model agent itu sendiri. Untuk ganti model di tengah jalan (misalnya Sonnet untuk ide, Opus untuk topologi dan task): tekan Esc, jalankan `/model`, lalu ketik `/bwa` atau "lanjut". Job yang masuk selama jeda menunggu di antrean sekitar dua menit.
- Selama mode otak, sesi agent tidak menyentuh file. Kode baru ditulis setelah serah-terima.

Cara kerjanya: setiap kali kamu menjalankan agent di UI, BWA menaruh prompt-nya di antrean. Sesi yang standby memanggil `wait_for_brain_job` (long-poll sekitar 40 detik), menjawab persis sesuai instruksi job, lalu mengirimnya dengan `submit_brain_result`. BWA mengubah jawabannya menjadi ide, topologi, atau task.

## Jalur PRD

Dari topologi, klik **Lanjut: pilih jalur** lalu **Tulis PRD**. Agent 3 menulis strategi dan rincian kebutuhan secara paralel, lalu BWA menyusunnya bersama topologi yang sudah kamu edit menjadi satu dokumen: ringkasan, latar belakang, tujuan dan batasan, metrik keberhasilan, persona, platform dan arsitektur, entitas data, cakupan fitur per modul (prioritas MoSCoW, kebutuhan FR-xx), integrasi, dependensi, user story dengan kriteria penerimaan, alur pengguna, kebutuhan non-fungsional, rencana rilis, risiko, pertanyaan terbuka, dan glosarium. Diagram Mermaid tampil sebagai gambar di GitHub dan Notion. Kamu bisa melihat pratinjau, mengedit (tersimpan otomatis), menyalin, atau mengunduh `.md`-nya.

## Agent coding lain

Agent yang hanya mengerjakan task (tanpa mode otak) bisa disambungkan dari halaman Task lewat **Hubungkan agent**, yang memberi perintah siap salin untuk Claude Code, Codex, Cursor, Gemini CLI, Windsurf, Cline, dan Claude Desktop (semuanya memakai format `mcpServers` yang sama).

Tool MCP: `list_projects`, `get_project_context`, `get_prd`, `list_tasks`, `get_next_task`, `get_task`, `claim_task`, `add_task_note`, `complete_task`, `block_task`, `release_task`, `create_task`, prompt `kerjakan_task`, serta untuk mode otak `wait_for_brain_job`, `submit_brain_result`, `fail_brain_job`, dan prompt `jadi_otak`.

Agent tanpa MCP bisa memakai CLI (`node bridge/cli.mjs help`) atau REST API di `/api/agent/projects/:id/…` (`context`, `prd`, `tasks`, `tasks/next`, `tasks/:taskId/claim`, `note`, `complete`, `block`, `release`).

## Menjalankan dari kode sumber

Butuh Node.js 22.6 atau lebih baru.

```bash
npm install
npm run dev        # API di http://127.0.0.1:3900, UI di http://localhost:5173
```

Mode produksi (satu port): `npm run build && npm start`, lalu buka http://127.0.0.1:3900.

Aplikasi desktop: `npm run desktop` untuk mencoba, atau bangun installer dengan `npm run desktop:dist` (Windows), `desktop:dist:mac`, atau `desktop:dist:linux`. Setiap tag `v*` yang di-push membangun ketiganya di [GitHub Actions](.github/workflows/release.yml) dan melampirkannya ke draft release.

Versi web dan desktop memakai kode dan port yang sama (3900), jadi jalankan salah satu saja. Datanya terpisah (versi web memakai folder `data/`).

Tes (masing-masing memakai server, folder data, dan folder konfigurasi Claude Code/Codex sementara, jadi pengaturanmu tidak tersentuh):

```bash
node scripts/brain-smoke-test.mjs     # otak MCP dari ujung ke ujung
node scripts/connect-smoke-test.mjs   # sambungkan satu klik (butuh Claude Code terpasang; BWA_TEST_CODEX=1 juga memeriksa lewat Codex CLI sungguhan)
node scripts/launch-test.mjs          # menyalakan aplikasi desktop hasil build dari release/ lalu memeriksanya
```

## Opsional: 9router

BWA juga bisa memakai [9router](https://github.com/decolua/9router), proxy API OpenAI-compatible, sebagai otak. Pilihan ini tersembunyi secara default. Aktifkan dengan `BWA_ENABLE_9ROUTER=1` di `.env` (web) atau `"enable9router": true` di `settings.json` folder data (desktop), lalu jalankan ulang BWA. Setelah itu Pengaturan menampilkan pilihan sumber otak, lengkap dengan model per agent. Lihat `.env.example`.

## Struktur proyek

```
server/app.ts          aplikasi HTTP (Hono): rute, jembatan agent; server/index.ts menjalankannya untuk versi web
server/agents/         prompt dan normalisasi Agent 1 (ide), 2 (topologi), 3 (task, PRD)
server/llm.ts          titik masuk otak: chat() → server/brainQueue.ts (MCP) atau 9router (opsional)
server/brainQueue.ts   antrean job untuk otak MCP (long-poll, timeout, status standby, serah-terima)
server/connect.ts      sambungkan satu klik untuk Claude Code dan Codex
bridge/                MCP server (stdio) dan CLI untuk agent coding
plugins/bwa/           plugin Claude Code (/bwa:start); juga dipasang sebagai /bwa oleh tombol Sambungkan
.claude-plugin/        marketplace plugin untuk repository ini
electron/main.ts       aplikasi desktop: server di dalam aplikasi, jendela, tray
shared/types.ts        model data bersama
src/                   UI React: beranda, Ide, Topologi, Task, PRD
scripts/               build desktop, ikon, tes
```

## Keamanan

- Server hanya mendengarkan di 127.0.0.1 dan menolak Host atau Origin selain localhost, jadi situs web lain tidak bisa memanggilnya.
- Menyambungkan agent hanya mengubah konfigurasinya setelah kamu setuju, dan hanya entri milik BWA.
- Untuk mengakses BWA dari perangkat lain, set `HOST=0.0.0.0` dan `BWA_ALLOWED_HOSTS` dengan sadar.

## Lisensi

[MIT](LICENSE) © Ariqo Banyusila Abrar
