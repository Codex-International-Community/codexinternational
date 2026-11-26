# frontend/TASKS.md — Frontend Implementation Backlog

> **PENTING (Wajib Dibaca Contributor & AI Agent):**
> File `frontend/TASKS.md` ini dibuat sebagai panduan daftar tugas UI/UX yang harus diselesaikan agar terhubung penuh dengan API backend yang sudah tersedia.
> **Hapus file `frontend/TASKS.md` ini jika seluruh checklist di bawah sudah selesai dikerjakan dan terverifikasi (`npm run lint` & `npm run build`).**

---

## 1. Fitur Moat Komunitas IT (`/api/v1/moat/*`)

- [ ] **Solved-to-Wiki UI (Public Read-Only + Promote Button):**
  - Tambahkan halaman/route publik `/wiki` dan `/wiki/:slug` (dapat diakses tanpa login, mirip `/threads`) yang memanggil `GET /api/v1/moat/wiki` dan `GET /api/v1/moat/wiki/:slug`.
  - Tambahkan tombol **"Promote to Wiki (Solved)"** di header/menu channel (`ChatPanel.tsx`) dan kartu Threads (`SocialPostCard.tsx`) yang memanggil `POST /api/v1/moat/wiki/from-channel/:id` atau `POST /api/v1/moat/wiki/from-post/:id`.

- [ ] **Verified Builder Profile (`/u/:username`) & Embeddable Badge:**
  - Buat halaman profil publik `/u/:username` memanggil `GET /api/v1/moat/builders/:username` (menampilkan level, XP, kontribusi approved, solved wiki count, posts count, dan skill tags).
  - Tambahkan tombol copy Markdown badge untuk GitHub README (`![Codex Builder](<API_BASE>/api/v1/moat/builders/:username/badge.svg)`).

- [ ] **Runnable Code Snippets & Inline Diff Viewer:**
  - Buat komponen viewer untuk `code_snippets` (`POST /api/v1/moat/snippets`, `GET /api/v1/moat/snippets/:id`) dengan:
    - Tombol **Run** (eksekusi aman JS/TS/HTML di sandboxed `iframe`/Web Worker di browser).
    - Tampilan **Inline Diff** (hijau `+` / merah `-`) untuk `diff_patch`.
    - Tombol **"Explain with AI"** yang memanggil `POST /api/v1/moat/snippets/:id/ai-explain`.

- [ ] **Skill Radar & Smart Question Routing UI:**
  - Tambahkan pengaturan **Skill Tags & Opt-In** di `SettingsView.tsx` (`GET / PUT /api/v1/moat/skills/me`).
  - Tambahkan panel/tab **Help Radar** untuk membuat pertanyaan bertag (`POST /api/v1/moat/radar/questions`), melihat daftar ahli yang ter-match, dan menandai pertanyaan sebagai `SOLVED` (`POST /api/v1/moat/radar/questions/:id/solve`).

- [ ] **Channel ↔ Threads Bridge (Open Topic & Resolution Banner):**
  - Tambahkan tombol **"Open Topic in Threads"** di header/menu `ChatPanel.tsx` yang memanggil `POST /api/v1/moat/channels/:id/open-thread` untuk membuat postingan Threads langsung dari diskusi channel.
  - Tambahkan banner **"Resolution Thread"** di atas feed `ChatPanel.tsx` (`GET /api/v1/moat/channels/:id/resolution`) dan kontrol moderator untuk menautkan/melepas `resolution_post_id` (`PUT/DELETE /api/v1/moat/channels/:id/resolution`).

---

## 2. Sinkronisasi UI dengan Fitur Backend yang Sudah Ada

- [ ] **Moderasi Komunitas (`communities/moderation.rs`):**
  - Hubungkan menu konteks member di `MembersPanel.tsx` / `MemberProfile.tsx` ke `POST/DELETE /api/v1/communities/:id/members/:uid/timeout`, `POST /api/v1/communities/:id/members/:uid/ban`, dan daftar ban (`DELETE /api/v1/communities/:id/bans/:uid`).

- [ ] **Infinite Scroll Up (`before_seq` Archive):**
  - Sambungkan scroll ke atas di `ChatPanel.tsx` ke `GET /api/v1/channels/:id/messages?before_seq=<oldest_seq>&limit=50` agar pesan lama & arsip R2 (`Task 2.7`) otomatis termuat.

- [ ] **Slash Command AI Langsung di `Composer.tsx`:**
  - Deteksi input `/ai `, `/ask `, `/summarize`, `/translate `, `/code ` langsung di input `Composer.tsx` (selain lewat `AiAssistantBar.tsx`), dan tampilkan hasil markdown dengan syntax highlighting.

- [ ] **E2EE Audio/Video Call (Saat WebRTC/SFU Mulai Dibangun):**
  - Implementasikan **WebRTC Insertable Streams / SFrame** untuk frame audio (voice chat/telepon) & video call saja (text chat/DM tetap non-E2EE demi moderasi).

---

## Checklist Penyelesaian (Sebelum Menghapus File Ini)

- [ ] Seluruh item di atas terhubung ke endpoint backend tanpa mock data.
- [ ] `npm --prefix frontend run lint` (`0` error) dan `npm --prefix frontend run build` (`tsc -b && vite build`) lulus.
- [ ] **Hapus `frontend/TASKS.md`** setelah semua task selesai.
