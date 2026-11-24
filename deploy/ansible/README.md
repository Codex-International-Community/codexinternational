# Ansible Project Setup

Playbook ini khusus untuk setup dan deploy project CodexInternational
(Docker Compose Postgres/Valkey, build frontend SPA, build Rust backend,
Caddy, dan systemd service), **tanpa** mengubah `.env` maupun setup dasar
VPS (hostname, user/group root, fail2ban, dll).

## Prasyarat

- `.env` sudah ada di `/home/<app_user>/projects/codexinternational/.env`
  sebelum service dijalankan.
- File kredensial eksternal (misalnya `fcm-service-account.json`) disalin ke
  `/home/<app_user>/secrets/` dengan permission `0600` (jika dipakai di
  `.env`).
- Copy `inventory.ini.example` ke `inventory.ini` lalu isi IP/host server.

## Jalankan

```bash
ansible-playbook -i deploy/ansible/inventory.ini \
  deploy/ansible/playbook.yml --ask-become-pass
```

## Seed Role `dev` Setelah Flush DB / Pindah Server

Migrasi `0005_seed_dev_raqilla.sql` hanya berjalan sekali saat `sqlx` migrasi
pertama kali dieksekusi. Jika database baru di-flush atau server baru masih
kosong saat playbook berjalan, register akun terlebih dahulu lalu jalankan:

```bash
bash deploy/ansible/seed-dev.sh
# atau tentukan email & slot UID secara eksplisit:
bash deploy/ansible/seed-dev.sh raqillaachmad@gmail.com 2
```
