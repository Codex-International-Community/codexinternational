# Ansible Project Setup

Playbook ini khusus untuk setup dan deploy project CodexInternational (Docker Compose Postgres/Valkey, build frontend SPA, build Rust backend, Caddy, dan systemd service), **tanpa** mengubah `.env` maupun setup dasar VPS (hostname, user/group root, fail2ban, dll).

## Prasyarat
- `.env` sudah ada di `/home/<app_user>/projects/codexinternational/.env` sebelum service dijalankan.
- Copy `inventory.ini.example` ke `inventory.ini` lalu isi IP/host server.

## Jalankan
```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml --ask-become-pass
```
