# Navair globe hero

## Current scope

User approved implementing the globe hero on the MacBook. The previous eight-scene implementation specification is future planning; this build implements only the globe hero and retains simple supporting business content. No publication or GitHub push was requested.

## Run

`npm install` then `npm run dev`. Open http://127.0.0.1:3000/ .

## Implementation

- Next.js 16 / React 19, scoped CSS Modules, locally bundled Space Grotesk and IBM Plex Mono.
- Hero copy is semantic HTML, server rendered with the page. Dynamic imports load Three.js and GSAP separately from the initial HTML.
- Original globe shaders, geographic point cloud, illustrative route arcs and location nodes. Source geometry: Natural Earth 1:110m public-domain land polygons; source and terms are recorded in `src/components/globe/globe-land.ts`. All samples are bundled locally; no map API, token, paid service or runtime map request.
- GSAP ScrollTrigger drives a single hero exit progress value. No page-wide smooth-scroll replacement or scroll interception.
- Engine includes bounded pixel ratio, offscreen/hidden-tab suspension, reduced-motion support and disposal of GPU resources/observers/listeners.
- Persistent enquiry actions, native mobile disclosure menu, skip-to-services link, pause control and a CSS globe fallback.
- Existing operational pages retain their original shared header. Homepage navigation belongs to the hero.

## Reference evidence

Reference https://unitedcarriers.com/ uses Webflow + Three.js for its globe. Public scripts show point-based geography, illustrative static route data, slow rotation, HTML labels, and separate atmospheric layers. We independently recreated the visual approach; no reference artwork, fonts or application code are reused.

## Verification

User initially requested no automated viewport checks, then explicitly authorized browser comparison with the reference. The subsequent audit measured the reference at 1280 × 720, 1440 × 900 and 390 × 844. Globe host sizing follows viewport height; desktop right offset is 14.47vw beyond the viewport. Browser screenshots and console checks are now used for the requested refinement. These are desktop browser/emulated viewport checks, not physical-phone performance benchmarks. No universal frame-rate claim is made.

Existing unit tests: 15 files / 162 tests passed. Additional TypeScript and production-build results are reported in the task response after the final changes.

## Known differences / review targets

This is a first independent implementation, not a verified pixel-identical reproduction. The font, independent atmosphere shader, route arrangement and geographic dataset differ from the reference. Perspective and viewport-height framing have been brought closer to measured reference values. Review the initial globe crop, density, rim intensity, title proportions and mobile composition on localhost. No Blender assets are needed for this section.

### Refinement validation

- Reference and Navair desktop globe hosts measured at 1280 × 720: 720px square, x≈745px, y=0.
- Local 390 × 844 browser viewport: hero ready, no horizontal overflow; mobile disclosure opens/closes with Escape; pause/resume state changes correctly.
- Browser console inspection returned no errors or warnings in these sessions.
- Regenerated staggered geographic samples: 8,162 inland + 3,876 coastline; generator in `scripts/generate-globe-land.py`.
- Country labels fade and prioritise the visible viewport crop. Width-only window resizing updates camera/label bounds even when the height-based host dimensions remain unchanged.
- TypeScript and production build passed. Physical-device frame rates remain unmeasured.

### Cursor and atmosphere refinement

- Mouse/pen dragging now rotates the globe with frame-rate-independent damping and bounded vertical tilt. Automatic rotation pauses during the gesture and resumes from the retained orientation. Manual dragging also works while automatic motion is paused. Touch gestures retain normal page scrolling.
- Country tags use 7px corners, softer backgrounds, 450ms opacity easing, and visibility falloff near the limb. Their positions continue tracking during fade-out.
- Restored the narrower orange/blue atmosphere, removing the broad inner blue band.
- Fixed window-resize listener cleanup on engine disposal.
- Browser verification: paused automatic motion, dragged the globe, and confirmed the visible geography and projected country labels changed. TypeScript and whitespace checks passed.

### Golden markers and starfield refinement

Country markers now have brighter amber cores and a shared, depth-tested halo layer (one additional draw call). Country labels use the site's IBM Plex Mono at 10px with warm-white text. Routes are slightly thicker and use a time-based amber-to-gold highlight; the existing pause and reduced-motion state freeze the highlight. Geography dots have increased white contrast. An original deterministic SVG starfield and restrained warm/cool CSS haze add background depth without video, raster imagery, or an additional animation loop. Browser inspection confirmed the updated appearance with no console errors.

### Simple golden routes and brighter geography

Supersedes the animated route treatment above: routes now use a uniform golden material, with no travelling particles or time-based highlights. Removed eight travelling meshes and their per-frame curve sampling. Inland dots now range from 82–100% white instead of 48–98%, with slightly larger, brighter cores and a gentler edge fade. Browser inspection confirmed the result with no console errors; production build passed.

### Travelling golden rays

Restored country-to-country motion as narrow shader streaks along the existing paths. Each route has a staggered 6.5-second cycle, an amber-to-gold midpoint gradient, and a pale-gold leading highlight. The streak clears the destination before resetting; no separate travelling sphere is used. Pause and reduced-motion settings freeze the shader time. The brighter geography is retained. Production build passed and browser rendering reported no console errors.


### Drag hit area and route alignment

Removed empty heading-layout hit areas that intercepted globe dragging; tightened active drag damping and delayed automatic rotation by 0.9 seconds after release. Verified downward dragging follows the cursor from the formerly blocked area. Rays now use a richer gold gradient and staggered 4.8-second travel cycles. All 27 markers are connected through 26 illustrative routes, with one shared coordinate source and matching marker/route endpoint radii. Connectivity and endpoint checks, TypeScript, and browser rendering passed. The final production rebuild was not repeated because the host repeatedly exhausted disk space; disposable project build artifacts were cleared during verification.
