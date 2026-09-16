# Frontend performance pass — 16 September 2026

Scope: globe, hero scrolling and enquiry startup. Video composition, resolution and playback behavior unchanged.

## Changes

- Batch all ordinary route geometries into one mesh, preserving their per-vertex phases and morph targets.
- Instance country marker spheres, preserving geometry and positions. Normal globe drawing falls from 58 calls to 7.
- Scope scroll CSS variables to the copy and map panels rather than invalidating the entire hero/canvas/label subtree.
- Load enquiry code ahead of time, but mount the form only when requested.
- Update labels only when the globe/view/focus changes. Read bounds once before label writes, skip inactive selected labels, and avoid unchanged opacity writes.
- Snap imperceptible drag/focus settling to its target. Verify static-map labels stop mutating and offscreen globe rendering stops.

## Measurements

Chrome headless on this Mac, 240-frame scripted reversible scroll, same viewport and CPU settings before/after. These are development-build comparisons, not physical-phone measurements.

| Measurement | Before | After |
| --- | ---: | ---: |
| Normal globe draw calls/frame | 58 | 7 |
| Desktop style recalculation time | 398 ms | 208 ms |
| Phone viewport, 4x CPU throttling: style recalculation | 924 ms | 349 ms |
| Phone viewport, 4x CPU throttling: total task time | 1825 ms | 978 ms |

Separate production-build sample with desktop DPR 2 and phone DPR 3 (renderer retains its existing 1.5/1.25 caps): median frame interval 16.7 ms, 95th percentile 16.7–16.8 ms, zero sampled frames over 25 ms. 240 frames per viewport; this is a short browser sample, not a universal 60 FPS guarantee or a sustained thermal test.

## Verification

Production build and ten globe tests pass. Browser checks cover desktop, 390px and 320px layouts, eager film loading, enquiry opening, globe dragging, zero settled-map label mutations, and zero WebGL draws after the globe leaves the viewport. No assets, point density, globe colors or route shapes were reduced.

Production preview: http://127.0.0.1:3001/. Development preview remains on port 3000. Actual iOS/Android device testing remains necessary.
