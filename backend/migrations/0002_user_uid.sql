-- ============================================================
-- USER UID (MMYY + 2-digit Role + Auto-Increment Suffix)
-- Reserved slots 1..10 (7 digits for 1..9, 8 digits for 10),
-- regular users auto-increment starting at 11.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS user_uid_seq
    AS BIGINT
    INCREMENT BY 1
    MINVALUE 11
    START WITH 11;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS uid VARCHAR(20),
    ADD COLUMN IF NOT EXISTS uid_login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET uid = to_char(created_at AT TIME ZONE 'UTC', 'MMYY') || '06' || nextval('user_uid_seq')::TEXT
WHERE uid IS NULL;

ALTER TABLE users
    ALTER COLUMN uid SET DEFAULT (
        to_char(NOW() AT TIME ZONE 'UTC', 'MMYY') || '06' || nextval('user_uid_seq')::TEXT
    ),
    ALTER COLUMN uid SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

CREATE TABLE IF NOT EXISTS reserved_uid_slots (
    slot_number SMALLINT PRIMARY KEY CHECK (slot_number BETWEEN 1 AND 10),
    default_role_code SMALLINT NOT NULL CHECK (default_role_code BETWEEN 0 AND 6),
    label VARCHAR(100) NOT NULL,
    assigned_user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ
);

INSERT INTO reserved_uid_slots (slot_number, default_role_code, label)
VALUES
    (1, 0, 'Reserved Slot 1 — Founder'),
    (2, 1, 'Reserved Slot 2 — Vice Founder'),
    (3, 1, 'Reserved Slot 3 — Vice Founder'),
    (4, 1, 'Reserved Slot 4 — Vice Founder / Lydora Dev'),
    (5, 1, 'Reserved Slot 5 — Core'),
    (6, 2, 'Reserved Slot 6 — Senior Admin'),
    (7, 2, 'Reserved Slot 7 — Senior Admin / Contributor'),
    (8, 3, 'Reserved Slot 8 — Contributor'),
    (9, 3, 'Reserved Slot 9 — Contributor'),
    (10, 3, 'Reserved Slot 10 — Contributor')
ON CONFLICT (slot_number) DO NOTHING;
