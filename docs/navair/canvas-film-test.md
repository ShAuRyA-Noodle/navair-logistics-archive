# Full-film canvas comparison

14 September 2026. Local opt-in test: http://127.0.0.1:3000/?player=canvas#services
Original video comparison: http://127.0.0.1:3000/#services

## Delivered

The complete 31.25-second movie-0-v4 edit is represented by 750 WebP frames per rendition at 24fps. Includes all cloud flight, release, parachute descent and the softened, non-interpolated landing. Both renditions are extracted from the approved desktop edit; no generated imagery or altered camera crops.

- Phone/tablet: 960×540, WebP quality 90, 44.7 MiB for all 750 files.
- Desktop: 1920×1080, WebP quality 90, 107.5 MiB for all 750 files.
- Extraction command: `python3 scripts/build-film-frames.py`. Requires FFmpeg and Python Pillow with WebP support. Streams raw frames through Pillow because the installed FFmpeg has no libwebp encoder. No temporary full PNG sequence is created.
- Manifest: `public/frames/movie-0-v4/manifest.json`. Version the directory and references when the underlying edit changes.

The new canvas component mounts only with `player=canvas`. The existing player remains the default. The deprecated Scene01-only canvas component is not used by this test.

## Loading and presentation

The loader prioritizes the current target, requests at most four images concurrently, cancels outdated requests, holds the last drawn frame while waiting, and supports explicit retry. Decoded cache limits are 16 phone/tablet images (31.6 MiB pixel data) and 8 desktop images (63.3 MiB pixel data). These are cache bounds, NOT total tab memory: in-flight decoding, canvas storage, browser caches, globe and the rest of the page add overhead.

Only a small target neighborhood is prefetched. Fetches use the browser cache for reverse scrolling. Work begins near the section and pauses offscreen or in hidden documents. There is no idle animation loop. Reduced-motion users explicitly load the film and can use an accessible position slider instead of scroll animation.

The film preserves its complete landscape composition on portrait screens. Landscape screens use the approved cover presentation. A canvas does not change the source camera or recover missing image area. The rejected full-height phone crop is not reintroduced. A mobile-sized rendition is selected on initial load; rotation resizes its presentation without clearing or redownloading the sequence. A larger desktop rendition is selected on a fresh wider-screen load.

## Measured checks

Chrome browser emulation on this Mac, using localhost; not physical iOS/Android testing and not a production CDN benchmark.

Local target jumps (six jumps including first entry and frame 749):

| Viewport | Observed end-to-end target arrival |
|---|---|
| 390×844 | 32–64 ms |
| 768×1024 | 31–58 ms |
| 1440×900 | 34–72 ms |

The sampled exploration downloaded approximately 5.1 MiB phone, 4.6 MiB tablet and 7.0 MiB desktop in the automated session. It did not download all 750 images. All files were checked for contiguous indexing, WebP validity and declared dimensions.

A separate cold-cache comparison used a 390×844 viewport, simulated 5 Mbps download throughput, 80 ms latency and 4× CPU slowdown. Neither player had fetched film resources before measurement. Tested positions were 60%, 95%, then 20%:

| Player | First target | Second target | Reverse target |
|---|---:|---:|---:|
| Canvas | 442 ms | 819 ms | 465 ms |
| Existing video | 41,368 ms | 101 ms | 26 ms |

Interpretation: canvas starts much sooner with the current implementation because it fetches nearby frames. The existing video player downloads its entire 24.2 MiB mobile file into a blob before displaying it. Once that file is loaded, these sampled video seeks were faster than uncached canvas targets. This is a comparison of these two implementations, not proof that canvas always outperforms video. Progressive video delivery would be a separate comparison.

Passed loader unit tests cover target priority, concurrency, reverse-seek cancellation, closing stale decoded images, cache bounds, error/retry behavior, endpoint clamping and disposal. Browser checks cover first load, fast forward/reverse seeks, final frame, idle drawing, manual slider, reduced-motion no-autoload and recovery after injected frame-request failures. TypeScript and diff checks pass.

## Remaining production decisions

1. Review the opt-in test on real iOS Safari and Android Chrome over Wi-Fi and cellular. Emulation does not establish all-device smoothness.
2. Measure continuous scrolling on slower connections; a full sweep through all images transfers more data than the video. Do not turn this test into the production default solely from its fast first frame.
3. Use the existing Blender project for a genuinely portrait composition if edge-to-edge vertical imagery is required. Canvas cannot provide that from these wide frames.
4. Serve versioned frames through a CDN with immutable caching for deployment, validate its network behavior, and tune frame quality/prefetch budgets from actual-device results. No new caching headers or CDN rollout are included in this local test.

No production push is part of this test.
