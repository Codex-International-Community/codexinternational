#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/rallc/projects/codexinternational}"
BACKUP_DIR="${BACKUP_DIR:-/home/rallc/backups/codexinternational}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-codexter-postgres}"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

: "${R2_BUCKET:?R2_BUCKET must be set in .env}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID must be set in .env}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID must be set in .env}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY must be set in .env}"

PG_USER="${POSTGRES_USER:-codexter}"
PG_DB="${POSTGRES_DB:-codexinternational}"

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${PG_DB}_${TIMESTAMP}.sql.gz"
TMP_FILE="${BACKUP_FILE}.tmp"
R2_KEY="backups/postgres/$(basename "${BACKUP_FILE}")"

echo "[backup-db] Dumping ${PG_DB} from container ${CONTAINER_NAME}..."
docker exec "${CONTAINER_NAME}" pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --no-acl | gzip -9 > "${TMP_FILE}"

if [[ ! -s "${TMP_FILE}" ]]; then
  rm -f "${TMP_FILE}"
  echo "[backup-db] ERROR: backup file is empty" >&2
  exit 1
fi

mv "${TMP_FILE}" "${BACKUP_FILE}"
chmod 600 "${BACKUP_FILE}"
echo "[backup-db] Uploading ${R2_KEY} to Cloudflare R2..."

python3 - "${BACKUP_FILE}" "${R2_BUCKET}" "${R2_ACCOUNT_ID}" "${R2_ACCESS_KEY_ID}" "${R2_SECRET_ACCESS_KEY}" "${R2_KEY}" <<'PY'
import datetime
import hashlib
import hmac
import sys
import urllib.request

file_path, bucket, account_id, access_key, secret_key, key = sys.argv[1:7]
with open(file_path, "rb") as f:
    payload = f.read()

host = f"{account_id}.r2.cloudflarestorage.com"
endpoint = f"https://{host}/{bucket}/{key}"
region = "auto"
service = "s3"

now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
date_stamp = now.strftime("%Y%m%d")
payload_hash = hashlib.sha256(payload).hexdigest()

canonical_uri = f"/{bucket}/{key}"
canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
signed_headers = "host;x-amz-content-sha256;x-amz-date"
canonical_request = f"PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
string_to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode()).hexdigest()}"

def sign(k, msg):
    return hmac.new(k, msg.encode("utf-8"), hashlib.sha256).digest()

k_date = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
k_region = sign(k_date, region)
k_service = sign(k_region, service)
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

auth_header = (
    f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
    f"SignedHeaders={signed_headers}, Signature={signature}"
)

req = urllib.request.Request(
    endpoint,
    data=payload,
    method="PUT",
    headers={
        "Host": host,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
        "Authorization": auth_header,
        "Content-Type": "application/gzip",
    },
)
with urllib.request.urlopen(req, timeout=120) as resp:
    if resp.status not in (200, 201, 204):
        raise RuntimeError(f"R2 upload failed with status {resp.status}")
PY

echo "[backup-db] Uploaded to R2: ${R2_KEY}"
find "${BACKUP_DIR}" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
echo "[backup-db] Pruned local backups older than ${RETENTION_DAYS} days"
