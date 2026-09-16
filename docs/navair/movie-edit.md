# Movie_0 — full flight, release and arrival

Revision 2 restores ALL of Scene_02-A. The earlier edit incorrectly skipped the first 4.04 seconds, removing the flight above the clouds.

- Keep Scene_01 in full, including takeoff.
- Join its ending to Scene_02-A from frame zero with a short source-derived cloud veil over a dissolve (14.25–15.0833 seconds).
- Preserve Scene_02-A's original flight, package release, parachute deployment, descent and ship landing, in that order and at original speed.
- Retain the final uncovered crate and parachutes beside it; append a 0.75-second settled end handle.
- Exclude Scene_02-B entirely.

Current duration after landing refinement: 31.25 seconds at 24 fps. The source aircraft design changes between the clips; this edit preserves the requested narrative rather than cutting the cloud-flight sequence to disguise that change.

## Delivery

Silent H.264, fast-start, no B-frames. Desktop 1920×1080 CRF19 with max 3-frame GOP; phone 960×540 CRF19 with max 2-frame GOP. Phone preserves the complete landscape composition. The player requests revision-2 URLs to avoid displaying the earlier cached film.

Timing and chapters are in `public/video/navair-film.json`.
Rebuild: `python3 scripts/build-navair-film.py --source-dir /path/to/Movie_0`.

## Landing refinement (revision 3)

The source hard cut at Scene_02-A frame 313 is softened with a 0.375s dissolve. Only the landing close-up is slowed to 1/1.75 of its original speed. Motion-compensated intermediate frames are generated within that shot (never across the camera cut) before returning to 24fps. The earlier flight/release/descent chronology remains intact. This is an editorial softening, not a reconstructed continuous camera move. The player requests revision-3 assets; duration is read from the generated metadata.

## Branding correction (revision 4)

Removed motion-compensated frame interpolation from the slowed landing close-up. The 0.375-second dissolve and 1.75× landing duration remain, but retiming now repeats original source frames instead of synthesizing lettering and box geometry. Original motion blur during the first touchdown frames remains; settled branding is taken directly from the source. The player requests revision-4 assets.

### Mobile playback repair (movie-0-v5)

A full-length browser playback check reproduced an Apple VideoToolbox decode failure at approximately 15.3 seconds in the mobile MP4. FFmpeg independently reported invalid NAL unit sizes and corrupt packets. The desktop MP4 passed a full strict decode.

Rebuilt the mobile asset from the clean desktop master at 960×540, 24 fps, H.264 High level 3.1, limited-range yuv420p, CRF 17, two-frame GOP and no B frames. It retains all 750 frames and the exact 31.25-second duration. Full strict decoding of the replacement reports no errors. The player asset query and metadata version are bumped to movie-0-v5 to bypass cached corrupt media. The movie build script now performs a strict full decode after each encode and fails if any decoder error is found.
