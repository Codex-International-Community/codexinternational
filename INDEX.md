# INDEX.md — Navigasi Arsitektur & Implementasi Backend CodexInternational

**Versi:** 1.2 (2026-11-17) — *Single Entry Point* untuk AI Coding Agent & Backend Engineer (Super-App Komunitas IT: Desktop Web React TS + Mobile Native Roadmap [transisi via Capacitor Hybrid], Discord-style Multi-Community Chat + WA Status Stories + Gamification, Runtime Rust Axum + PostgreSQL + Valkey 9.x + Cloudflare R2 + AWS Lambda).

---

## 1. Peta Dokumen Utama

Perlakukan dokumen di bawah ini sebagai modul independen dengan pemisahan tanggung jawab (*Separation of Concerns*):

| Dokumen | Peran & Tanggung Jawab Utama | Rujukan Kunci |
| :--- | :--- | :--- |
| **[`backend/PRD.md`](backend/PRD.md)** | Hukum teknis tertinggi sisi backend: arsitektur sistem, Valkey state schema, PostgreSQL DDL, invariants (`INV-1..16`), decision log (`DEC-1..17`), dan gotchas. | `P§1.2` (Valkey State Schema), `P§1.3` (PostgreSQL DDL), `P§5` (`INV-1..16`), `P§6` (`DEC-1..17`), `P§7` (Gotchas) |
| **[`backend/TASKS.md`](backend/TASKS.md)** | Roadmap implementasi teknis TDD Rust per-fase (`Fase 0`–`Fase 6`). Wajib lolos *Phase Gate* sebelum melangkah ke fase berikutnya. | `Fase 0` (Infra & Workspace), `Fase 1` (Auth & Core), `Fase 2` (Chat & Write-Behind), `Fase 3` (Media Pipeline), `Fase 4` (Stories, Gamification & FCM), `Fase 5` (Load Test & Hardening) |

---

## 2. Aturan Hirarki & Resolusi Konflik

Jika terdapat pertentangan antar-dokumen, selesaikan dengan urutan prioritas berikut:

1. **Invariants (`backend/PRD.md P§5`, `INV-1..16`):** Menang mutlak; pelanggaran invariant dihitung sebagai *critical bug*.
2. **State Schema & DDL (`backend/PRD.md P§1.2` & `P§1.3`):** Single source of truth untuk seluruh key Valkey, tabel PostgreSQL, payload WebSocket, dan endpoint REST.
3. **Tasks vs PRD:** [`backend/PRD.md`](backend/PRD.md) menang atas [`backend/TASKS.md`](backend/TASKS.md).
4. **Inkonsistensi:** Laporkan dengan format `[INKONSISTENSI] <file1> vs <file2>` dan selesaikan sebelum implementasi berlanjut.

---

## 3. Konvensi Prefix Cross-Reference

| Prefix | Domain Rujukan | Contoh |
| :--- | :--- | :--- |
| `P§x.y` | [`backend/PRD.md`](backend/PRD.md) | `P§1.2` (Valkey State Schema), `P§5` (Invariants), `P§7` (Gotchas) |
| *Bare* | Invariant, Keputusan Arsitektur, Task, Gate | `INV-1`..`16`, `DEC-1`..`17`, `Task 2.1`, `Gate 2` |

---

## 4. Alur Kerja Cepat (Quick Navigation)

```text
Mau Mulai Implementasi Backend?
├── 1. Baca Konteks & Scope   → P§0 & P§1.1 (Glosarium & Fase 1–3 Boundary)
├── 2. Cek State & Schema     → P§1.2 (Valkey Keys) & P§1.3 (PostgreSQL 0001_init.sql)
├── 3. Cek Hukum Invariant    → P§5 (INV-1..16) & P§7 (Implementation Gotchas)
├── 4. Eksekusi Task (TDD)    → backend/TASKS.md (Red → Green → Refactor + Phase Gate)
└── 5. Verifikasi Bukti       → cargo fmt --check && cargo clippy --workspace -- -D warnings && cargo test --workspace
```
