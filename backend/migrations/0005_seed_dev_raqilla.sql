-- Promote raqillaachmad@gmail.com to platform_role = 'dev' and assign reserved UID slot 2 (if available).
DO $$
DECLARE
    target_user_id UUID;
    target_created_at TIMESTAMPTZ;
    slot_owner UUID;
    new_uid VARCHAR(20);
BEGIN
    SELECT id, created_at
    INTO target_user_id, target_created_at
    FROM users
    WHERE LOWER(email) = 'raqillaachmad@gmail.com'
    LIMIT 1;

    IF target_user_id IS NOT NULL THEN
        SELECT assigned_user_id
        INTO slot_owner
        FROM reserved_uid_slots
        WHERE slot_number = 2;

        IF slot_owner IS NULL OR slot_owner = target_user_id THEN
            new_uid := to_char(target_created_at AT TIME ZONE 'UTC', 'MMYY') || '012';

            UPDATE users
            SET platform_role = 'dev',
                uid = new_uid
            WHERE id = target_user_id;

            UPDATE reserved_uid_slots
            SET assigned_user_id = target_user_id,
                assigned_at = NOW()
            WHERE slot_number = 2;
        ELSE
            UPDATE users
            SET platform_role = 'dev'
            WHERE id = target_user_id;
        END IF;
    END IF;
END $$;
