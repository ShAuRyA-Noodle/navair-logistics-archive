# Scroll animation investigation — 2026-09-13

No production changes made during this investigation.

## Isolated test
60 alternating seeks per fully downloaded blob, one requestAnimationFrame between requests, in the local Codex in-app browser. No globe, React, GSAP or Lenis. This measures seeked events, NOT compositor presentation or phone performance.

| Asset | Median | p95 | Maximum |
| --- | --- | --- | --- |
| 540p mobile | 3.4 ms | 10.1 ms | 41.4 ms |
| 1080p desktop | 6 ms | 7.7 ms | 17.4 ms |

Therefore raw decoding cost alone is not established as the main cause. Homepage compositing, seek-to-presentation latency, scroll cadence and real phone behavior remain unmeasured. The current implementation waits for seeked, then schedules the next seek on RAF; this is an asynchronous media pipeline rather than deterministic drawing. The 24 fps source also bounds the number of distinct source frames.

## Direct reference inspection
- https://lusion.co/_astro/hoisted.CUO_IjfL.js contains Three.js WebGL rendering and a looping VideoTexture reel with mobile and desktop sources. This does not establish every animation's implementation or universal frame rates.
- Correct logistics domain is https://unitedcarriers.com (unitedcarries.com did not resolve).
- Its https://united-carriers.netlify.app/main.js imports OceanScene, vendor-three, vendor-gsap, Lenis, globe and frame-sequence chunks.
- https://united-carriers.netlify.app/chunks/frame-sequence-DVzLzLQ6.js contains 2D canvas drawImage, image caching, nearby-frame loading, a target/display playhead with default lerp .15, optional windowed loading, optional frame skipping and resize handling.
- https://united-carriers.netlify.app/chunks/OceanScene-CggVSafL.js loads water normal/environment textures as part of a separate real-time scene.

## Recommended next experiment
Compare a canvas WebP frame-sequence prototype against MP4 with the SAME scroll trace, on the full homepage. Measure target-to-presented-frame delay, RAF gaps, memory and load time. Keep a bounded decoded-frame cache: 362 RGBA frames at 1920x1080 would be about 2.8 GiB, so pre-decoding the whole sequence is unsuitable. Prioritize the target frame, prefetch nearby frames and retain the last drawable frame during fast input. Profile with the globe present and disabled to isolate GPU overlap. Use real phone measurements before claiming resolution.
