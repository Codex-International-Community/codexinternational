//! XP progression formula shared by community and global profiles.
//!
//! The PRD defines: level = floor(sqrt(xp / 100)) + 1.
//! Negative XP is treated as zero so malformed persisted values cannot create
//! a level below one.

/// Calculates a user's level from their total experience points.
///
/// Progression thresholds:
/// - 0..=99 XP: level 1
/// - 100..=399 XP: level 2
/// - 400..=899 XP: level 3
/// - 900..=1599 XP: level 4
///
/// Uses an integer square root to avoid floating-point boundary errors.
pub fn calculate_level(xp: i64) -> i32 {
    let normalized_xp = xp.max(0) as u64;
    let progression_band = normalized_xp / 100;
    (integer_sqrt(progression_band) + 1) as i32
}

/// Returns floor(sqrt(value)) without floating-point rounding.
///
/// Binary search is bounded by 2^32, the largest possible square-root
/// candidate for a u64 input. Division is used instead of multiplication to
/// avoid overflow.
fn integer_sqrt(value: u64) -> u64 {
    let mut low = 0_u64;
    let mut high = 1_u64 << 32;

    while low + 1 < high {
        let mid = low + (high - low) / 2;
        if mid <= value / mid {
            low = mid;
        } else {
            high = mid;
        }
    }

    low
}

#[cfg(test)]
mod tests {
    use super::calculate_level;

    #[test]
    fn starts_at_level_one_for_zero_and_negative_xp() {
        assert_eq!(calculate_level(0), 1);
        assert_eq!(calculate_level(-1), 1);
        assert_eq!(calculate_level(i64::MIN), 1);
    }

    #[test]
    fn stays_in_level_one_until_one_hundred_xp() {
        assert_eq!(calculate_level(1), 1);
        assert_eq!(calculate_level(99), 1);
        assert_eq!(calculate_level(100), 2);
    }

    #[test]
    fn respects_quadratic_progression_boundaries() {
        assert_eq!(calculate_level(399), 2);
        assert_eq!(calculate_level(400), 3);
        assert_eq!(calculate_level(899), 3);
        assert_eq!(calculate_level(900), 4);
        assert_eq!(calculate_level(1_599), 4);
        assert_eq!(calculate_level(1_600), 5);
    }

    #[test]
    fn handles_large_xp_without_overflow_or_float_rounding() {
        assert_eq!(calculate_level(i64::MAX), 303_700_050);
    }
}
