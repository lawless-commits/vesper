//! Timezone helpers for autopilot quiet hours and the "actions today" window,
//! so both follow the user's configured timezone instead of the server clock.

use chrono::{DateTime, LocalResult, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

pub const DEFAULT_TIME_ZONE: &str = "UTC";

/// Autopilot quiet hours: 01:00 up to (not including) 07:00 local time.
pub const QUIET_START_HOUR: u32 = 1;
pub const QUIET_END_HOUR: u32 = 7;

/// True for an IANA timezone name, e.g. "Africa/Johannesburg".
pub fn is_valid_time_zone(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 64 && value.parse::<Tz>().is_ok()
}

/// The given timezone if valid, otherwise UTC.
pub fn safe_time_zone(value: &str) -> String {
    if is_valid_time_zone(value) { value.to_string() } else { DEFAULT_TIME_ZONE.to_string() }
}

fn tz(name: &str) -> Tz {
    name.parse().unwrap_or(Tz::UTC)
}

/// Hour of the day (0-23) of `at` in `time_zone`.
pub fn local_hour(at: DateTime<Utc>, time_zone: &str) -> u32 {
    at.with_timezone(&tz(time_zone)).hour()
}

/// The instant at which the local calendar day containing `at` began in
/// `time_zone` (local midnight). Correct across daylight-saving changes.
pub fn start_of_local_day(at: DateTime<Utc>, time_zone: &str) -> DateTime<Utc> {
    let zone = tz(time_zone);
    let midnight = at.with_timezone(&zone).date_naive().and_time(NaiveTime::MIN);
    match zone.from_local_datetime(&midnight) {
        LocalResult::Single(start) => start.with_timezone(&Utc),
        LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        // Midnight was skipped by a DST jump: the day began at the first
        // instant that does exist, an hour later.
        LocalResult::None => {
            let later = midnight + chrono::Duration::hours(1);
            zone.from_local_datetime(&later).earliest().map_or(at, |start| start.with_timezone(&Utc))
        }
    }
}

pub fn is_quiet_hour(at: DateTime<Utc>, time_zone: &str) -> bool {
    let hour = local_hour(at, time_zone);
    (QUIET_START_HOUR..QUIET_END_HOUR).contains(&hour)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn local_hours() {
        assert_eq!(local_hour(utc("2026-11-16T23:30:00Z"), "UTC"), 23);
        assert_eq!(local_hour(utc("2026-11-16T23:30:00Z"), "Africa/Johannesburg"), 1);
        assert_eq!(local_hour(utc("2026-11-16T23:30:00Z"), "America/New_York"), 18);
        assert_eq!(local_hour(utc("2026-07-16T23:30:00Z"), "America/New_York"), 19);
        assert_eq!(local_hour(utc("2026-11-16T22:00:00Z"), "Africa/Johannesburg"), 0);
    }

    #[test]
    fn quiet_hours_follow_the_timezone() {
        let at = utc("2026-11-16T23:30:00Z");
        assert!(is_quiet_hour(at, "Africa/Johannesburg"));
        assert!(!is_quiet_hour(at, "UTC"));
        let zone = "Africa/Johannesburg";
        assert!(!is_quiet_hour(utc("2026-11-16T22:59:59Z"), zone)); // 00:59
        assert!(is_quiet_hour(utc("2026-11-16T23:00:00Z"), zone)); // 01:00
        assert!(is_quiet_hour(utc("2026-11-17T04:59:59Z"), zone)); // 06:59
        assert!(!is_quiet_hour(utc("2026-11-17T05:00:00Z"), zone)); // 07:00
    }

    #[test]
    fn quiet_hours_across_new_york_dst() {
        assert!(is_quiet_hour(utc("2026-01-15T06:30:00Z"), "America/New_York"));
        assert!(is_quiet_hour(utc("2026-07-15T06:30:00Z"), "America/New_York"));
        assert!(is_quiet_hour(utc("2026-01-15T11:30:00Z"), "America/New_York"));
        assert!(!is_quiet_hour(utc("2026-07-15T11:30:00Z"), "America/New_York"));
    }

    #[test]
    fn day_starts() {
        assert_eq!(start_of_local_day(utc("2026-11-16T15:45:10Z"), "UTC"), utc("2026-11-16T00:00:00Z"));
        let jhb = "Africa/Johannesburg";
        assert_eq!(start_of_local_day(utc("2026-11-16T21:59:00Z"), jhb), utc("2026-11-15T22:00:00Z"));
        assert_eq!(start_of_local_day(utc("2026-11-16T22:00:00Z"), jhb), utc("2026-11-16T22:00:00Z"));
        assert_eq!(start_of_local_day(utc("2026-11-16T23:30:00Z"), jhb), utc("2026-11-16T22:00:00Z"));
        let ny = "America/New_York";
        // Spring forward (8 March 2026) and fall back (1 November 2026).
        assert_eq!(start_of_local_day(utc("2026-03-08T15:00:00Z"), ny), utc("2026-03-08T05:00:00Z"));
        assert_eq!(start_of_local_day(utc("2026-03-09T15:00:00Z"), ny), utc("2026-03-09T04:00:00Z"));
        assert_eq!(start_of_local_day(utc("2026-11-01T15:00:00Z"), ny), utc("2026-11-01T04:00:00Z"));
        assert_eq!(start_of_local_day(utc("2026-11-02T15:00:00Z"), ny), utc("2026-11-02T05:00:00Z"));
    }

    #[test]
    fn validation() {
        assert!(is_valid_time_zone("Africa/Johannesburg"));
        assert!(is_valid_time_zone("UTC"));
        assert!(!is_valid_time_zone("Mars/Olympus_Mons"));
        assert!(!is_valid_time_zone(""));
        assert_eq!(safe_time_zone("nope"), "UTC");
    }
}
