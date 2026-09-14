# Movie_0 — full flight, release and arrival

Revision 2 restores ALL of Scene_02-A. The earlier edit incorrectly skipped the first 4.04 seconds, removing the flight above the clouds.

- Keep Scene_01 in full, including takeoff.
- Join its ending to Scene_02-A from frame zero with a short source-derived cloud veil over a dissolve (14.25–15.0833 seconds).
- Preserve Scene_02-A's original flight, package release, parachute deployment, descent and ship landing, in that order and at original speed.
- Retain the final uncovered crate and parachutes beside it; append a 0.75-second settled end handle.
- Exclude Scene_02-B entirely.

Expected duration: 30.0833 seconds at 24 fps. The source aircraft design changes between the clips; this edit preserves the requested narrative rather than cutting the cloud-flight sequence to disguise that change.

## Delivery

Silent H.264, fast-start, no B-frames. Desktop 1920×1080 CRF19 with max 3-frame GOP; phone 960×540 CRF19 with max 2-frame GOP. Phone preserves the complete landscape composition. The player requests revision-2 URLs to avoid displaying the earlier cached film.

Timing and chapters are in `public/video/navair-film.json`.
Rebuild: `python3 scripts/build-navair-film.py --source-dir /path/to/Movie_0`.
