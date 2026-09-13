# Canvas experiment and Earth palette

Local comparison URLs:
- Existing video: http://127.0.0.1:3000/
- Canvas: http://127.0.0.1:3000/?scene=canvas

364 original frames per variant, extracted from Scene01.mp4 using scripts/build-scene-frames.py. Desktop 1440x810, phone 960x540. WebP quality 82. Complete sequence sizes about 30 MiB desktop / 18 MiB phone; only nearby frames are requested initially. These compressed sequences are larger overall than the MP4 variants, so canvas is not a bandwidth saving claim.

Decoded cache is capped at 12 desktop frames (~53 MiB RGBA) or 24 phone frames (~47 MiB RGBA), plus up to four in-flight decodes and browser/compositor overhead. Cache explicitly closes evicted ImageBitmaps. Four active fetches, destination-first loading, obsolete requests aborted, last drawable frame retained. Animation RAF stops when settled; no React per-scroll state updates. Original video remains the default pending a real-device comparison.

Functional checks on full homepage: desktop forward jump converged at frame 191 with cache 12, phone settled at frame 82 with cache 17 and no horizontal overflow. Both used actual generated frames; screenshots inspected. These checks do not establish FPS, end-to-end latency improvement or real-phone performance.

Globe: emerald/blue atmosphere and routes, brighter dots, modestly larger hero and map, existing continuous quintic transition retained. Enquiry outer card/header removed; footer enquiry opens the same map-scene form instead of navigating to the standalone route. Internal overflow remains available for long questions/short screens.
