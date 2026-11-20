//! Permission bitmask helpers for community roles.

pub const PERM_VIEW_CHANNEL: i64 = 1 << 0;
pub const PERM_SEND_MESSAGES: i64 = 1 << 1;
pub const PERM_MANAGE_MESSAGES: i64 = 1 << 2;
pub const PERM_MENTION_EVERYONE: i64 = 1 << 3;
pub const PERM_MANAGE_CHANNELS: i64 = 1 << 4;
pub const PERM_MANAGE_ROLES: i64 = 1 << 5;
pub const PERM_MODERATE_CONTRIBUTIONS: i64 = 1 << 6;
pub const PERM_ADMINISTRATOR: i64 = 1 << 7;
pub const PERM_MODERATE_MEMBERS: i64 = 1 << 8;

/// Returns true when all requested permission bits are granted.
/// The administrator bit bypasses individual permission checks.
pub const fn has_permission(granted: i64, required: i64) -> bool {
    (granted & PERM_ADMINISTRATOR) != 0 || (granted & required) == required
}

/// A role may manage only a strictly lower position.
pub const fn can_manage_position(actor_position: i32, target_position: i32) -> bool {
    actor_position > target_position
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_all_requested_permissions() {
        assert!(has_permission(
            PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES,
            PERM_VIEW_CHANNEL
        ));
        assert!(!has_permission(
            PERM_VIEW_CHANNEL,
            PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES
        ));
    }

    #[test]
    fn administrator_bypasses_permission_checks() {
        assert!(has_permission(
            PERM_ADMINISTRATOR,
            PERM_MODERATE_MEMBERS | PERM_MANAGE_ROLES
        ));
    }

    #[test]
    fn enforces_strict_role_hierarchy() {
        assert!(can_manage_position(1000, 500));
        assert!(can_manage_position(500, 0));
        assert!(!can_manage_position(500, 500));
        assert!(!can_manage_position(0, 500));
    }
}
