# Adaptive Uffizio Polling — Plan

Status: proposal. Nothing implemented. Prod audit run 2026-10-13 (read-only).

## Goal

Poll Uffizio for in-transit seals at an interval driven by how close each truck is to its next target, instead of one fleet-wide interval (`sync_frequency_minutes`, default 15). Uffizio geofence alerts stay disabled (Uffizio can't tell SJs in transit from those not), so arrival detection and scheduling stay internal, on the existing 1-minute cron.

## Current state

- `hooks.py`: `scheduled_sync_active_journeys` and `scheduled_sync_all_devices` run every minute.
- `api/seal_sync.py::scheduled_sync_active_journeys` gates on one global timer (`last_active_journey_sync_time` vs `sync_frequency_minutes`), then syncs every In Transit / Ready for Journey journey together.
- Uffizio quota (per call vs per device) is **unknown**.

## Design

### 1. Per-journey schedule
- Add `next_poll_at` (Datetime) and `last_known_distance_km` (Float) to the in-transit records.
- Every minute: select rows where `next_poll_at <= now` or is empty; send one batch call with only those IMEIs; drop the global gate. Keep `sync_frequency_minutes` as the ceiling.

### 2. Interval from distance (conservative)
- `D` = great-circle distance from last fix to next target (always <= road distance, so it only over-polls).
- `t_min = max(0, D - v_max * minutes_since_fix) / v_max`, `v_max = 100 km/h`.
- `interval = clamp(t_min / 2, 1, 30)` minutes. Roughly: far = 30, mid = 15, approaching = 7, arrival zone (<= 15 km) = 1-3.
- Using `v_max` instead of current speed removes the v=0 and speed-swing problems.

### 3. Fallbacks
- No next target (see coverage below): fixed default, 10 min, configurable in Seal API Settings.
- No fix, or fix older than 30 min: poll at the ceiling and flag the device offline.
- Off route / no resolvable target: 5 min.
- Arrival zone: 1 min until arrival logic fires.

### 4. Next target
First checkpoint not yet arrived / with future `expected_arrival`, else `destination` via `Transport Location`. Coordinates from `Transport Location.latitude/longitude`, else its linked `Uffizio Geofence`.

### 5. Arrival detection (internal)
Compare each fix to our own geofence. Require two consecutive fixes inside the radius, or one fix with speed under ~5 km/h, to avoid GPS-jitter false arrivals.

### 6. Batching / cost
Send only due IMEIs per tick. If Uffizio limits per call (not per device), send all IMEIs per call instead; the arrival-zone truck then sets the cadence and batching saves nothing. Resolve the quota question first (ask Uffizio, or look for 429s / rate-limit headers in logs).

### 7. Visibility
Log `D`, chosen interval and `next_poll_at` on every sync.

## Prod coverage audit (2026-10-13) — the blocker

| Check | Result |
|---|---|
| Active Journey Requests (`Journey Ready`) | 110 (= 110 active Seal Journeys, all linked) |
| Destination has coordinates | 0 / 110 |
| Has >= 1 checkpoint | 25 |
| Checkpoints resolving to a geofence with coordinates | 0 / 25 |
| **Usable target** | **0 / 110** |
| Last 90 days (278 journeys) with usable target | 14 (~5%), all via destination coordinates |
| `Transport Location` with coordinates | 16 / 196 (the same 16 have a linked geofence) |
| `Uffizio Geofence` with lat/lng | 698 / 707 (geofence data itself is fine) |

Causes:
- Active destinations are mostly names without coordinates: `uganda`, `Rwanda`, `PORT OF MOMBASA`, `Njd`, `VIVO ENERGY NBI`, `IBER`, `LIMURU`, `TATU CITY NBI`. Country-level ones (`uganda`, `Rwanda`) need a representative point.
- All 25 active checkpoint rows are `Cabanas`, which does not exist in `Uffizio Geofence`. 67 checkpoint rows overall are dangling links. Cause not yet found (candidate: geofence rename/removal during daily `geofence_sync`; unverified).

Without fixing this, every journey falls back to the fixed default and the distance logic adds no value.

## Phases

0. **Data fix (first)**
   - Backfill `Transport Location` coordinates / `uffizio_geofence` link. ~20 distinct destinations cover the active journeys; do the high-volume ones first. Draft a name-match script (`Transport Location` -> `Uffizio Geofence`), review matches before applying.
   - Pick representative points for country-level destinations.
   - Investigate the dangling `Cabanas` / 67 checkpoint links.
   - Longer term: require a coordinate-backed destination at tagging in the Journey Request.
1. **Log-only**: add `next_poll_at`, compute the interval for both paths (distance-based and fixed default), log it alongside the current 15-min poll for about a week.
2. **Cut over**: scheduler uses `next_poll_at`; drop the global gate.
3. **Arrival detection**: switch to internal geofence-entry logic last.

## Open questions

- Uffizio quota: per call or per device?
- Representative points for country-level destinations?
- Source of the dangling `Cabanas` checkpoint?
