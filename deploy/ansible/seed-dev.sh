#!/usr/bin/env bash
set -euo pipefail

TARGET_EMAIL="${1:-raqillaachmad@gmail.com}"
SLOT_NUMBER="${2:-2}"
PROJECT_DIR="${PROJECT_DIR:-/home/rallc/projects/codexinternational}"
CONTAINER_NAME="${POSTGRES_CONTAINER:-codexter-postgres}"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

PG_USER="${POSTGRES_USER:-codexter}"
PG_DB="${POSTGRES_DB:-codexinternational}"

if ! docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q true; then
  echo "[seed-dev] ERROR: container '${CONTAINER_NAME}' is not running." >&2
  exit 1
fi

if ! docker exec "${CONTAINER_NAME}" psql -U "${PG_USER}" -d "${PG_DB}" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'users';" | grep -q 1; then
  echo "[seed-dev] Table 'users' does not exist yet. Run backend migrations first."
  exit 0
fi

USER_EXISTS=$(docker exec -i "${CONTAINER_NAME}" psql -U "${PG_USER}" -d "${PG_DB}" -tAc \
  "SELECT 1 FROM users WHERE LOWER(email) = LOWER('${TARGET_EMAIL//\'/\'\'}') LIMIT 1;")

if [[ "${USER_EXISTS}" != "1" ]]; then
  echo "[seed-dev] User '${TARGET_EMAIL}' is not registered yet. Register first, then re-run this script."
  exit 0
fi

docker exec -i "${CONTAINER_NAME}" psql -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE
    target_user_id UUID;
    target_created_at TIMESTAMPTZ;
    slot_owner UUID;
    new_uid VARCHAR(20);
BEGIN
    SELECT id, created_at
    INTO target_user_id, target_created_at
    FROM users
    WHERE LOWER(email) = LOWER('${TARGET_EMAIL//\'/\'\'}')
    LIMIT 1;

    IF target_user_id IS NOT NULL THEN
        SELECT assigned_user_id
        INTO slot_owner
        FROM reserved_uid_slots
        WHERE slot_number = ${SLOT_NUMBER};

        IF slot_owner IS NULL OR slot_owner = target_user_id THEN
            new_uid := to_char(target_created_at AT TIME ZONE 'UTC', 'MMYY') || '01' || ${SLOT_NUMBER}::TEXT;

            UPDATE users
            SET platform_role = 'dev',
                uid = new_uid
            WHERE id = target_user_id;

            UPDATE reserved_uid_slots
            SET assigned_user_id = target_user_id,
                assigned_at = NOW()
            WHERE slot_number = ${SLOT_NUMBER};
        ELSE
            UPDATE users
            SET platform_role = 'dev'
            WHERE id = target_user_id;
        END IF;
    END IF;
END \$\$;

SELECT id, username, email, uid, platform_role
FROM users
WHERE LOWER(email) = LOWER('${TARGET_EMAIL//\'/\'\'}');
SQL

echo "[seed-dev] Done: '${TARGET_EMAIL}' has platform_role='dev'."
