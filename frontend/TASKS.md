# TASKS.md — Integrasi User UID & Opt-In UID Login (`frontend/`)

> **Catatan:** Hapus file ini (`frontend/TASKS.md`) setelah seluruh integrasi UI di bawah selesai diimplementasikan.

---

## 1. Kontrak API Backend yang Sudah Tersedia

Seluruh response `AuthUserProfile` (`/api/v1/auth/me`, `/login`, `/register`, `/otp/verify`, `/oauth/{provider}`) kini menyertakan 3 field tambahan:

```ts
export interface AuthUserProfile {
  // ...field yang sudah ada
  uid: string
  uid_login_enabled: boolean
  has_password: boolean
}
```

Endpoint baru di backend:

- `PUT /api/v1/auth/password` (Bearer Auth)
  - Body: `{ current_password?: string, new_password: string }`
  - Wajib dipanggil oleh user OAuth/OTP (`has_password === false`) untuk membuat password pertama kali sebelum menyalakan login via UID. Jika `has_password === true`, wajib sertakan `current_password`.
  - Response `200 OK`: `{ user: AuthUserProfile }`.
- `PATCH /api/v1/auth/uid-login` (Bearer Auth)
  - Body: `{ enabled: boolean }`
  - Mengaktifkan/menonaktifkan login memakai UID. Backend menolak `400 Bad Request` bila `enabled: true` saat `has_password === false`.
  - Response `200 OK`: `{ user: AuthUserProfile }`.
- `POST /api/v1/auth/login` (sudah mendukung UID)
  - Field `identifier` otomatis menerima `email`, `username`, atau `uid` (hanya jika `uid_login_enabled === true`).
- Khusus `platform_role === 'dev'`:
  - `GET /api/v1/dev/uid-slots` — melihat daftar slot reserved `1..10`.
  - `POST /api/v1/dev/users/{id}/assign-uid` — body `{ slot_number: number, role_code?: number, platform_role?: 'dev' | 'moderator' | 'user' }` untuk meng-assign UID reserved `1..10` (7 digit untuk `1..9`, 8 digit untuk `10`).

---

## 2. Checklist Integrasi Frontend

- [ ] **Tipe & API Client (`frontend/src/api/client.ts`, `frontend/src/api/auth.ts`):**
  - Tambahkan `uid`, `uid_login_enabled`, dan `has_password` ke interface `AuthUserProfile`.
  - Tambahkan helper `setOrChangePassword(...)` (`PUT /api/v1/auth/password`) dan `toggleUidLogin(enabled)` (`PATCH /api/v1/auth/uid-login`) lalu panggil `updateSessionUser(res.user)`.
- [ ] **Halaman Login (`frontend/src/pages/Landing.tsx`):**
  - Perbarui label & placeholder tab Password dari `USERNAME OR EMAIL` menjadi `USERNAME, EMAIL, OR UID` (UID hanya bekerja bila user sudah menyalakan opsi login via UID).
- [ ] **Halaman Settings (`frontend/src/components/views/SettingsView.tsx`):**
  - Tampilkan `UID` milik user (mis. `UID: 11260611`) lengkap dengan tombol salin (untuk keperluan profil/temenan).
  - Tambahkan checkbox/toggle **Izinkan login menggunakan UID**.
  - Jika `!authUser.has_password` (user login lewat OAuth/OTP), tampilkan form/aksi **Set Password** terlebih dahulu dan nonaktifkan/arahkan toggle UID login sampai `has_password === true`.
- [ ] **Verifikasi:** Jalankan `npm run lint` dan `npm run build` di `frontend/`, lalu hapus `frontend/TASKS.md`.
