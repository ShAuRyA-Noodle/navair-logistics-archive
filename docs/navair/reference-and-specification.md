# Navair — reference audit and implementation specification

Prepared 12 September 2026. Reference: https://unitedcarriers.com/ . Existing project: Next.js 16.3.4, React 19, TypeScript, CSS Modules; preserve existing enquiry, forecast, news and operations routes.

## Evidence and limits

Live homepage inspected at 1280 × 720 and 390 × 844, including forward and reverse scrolling, mobile menu, mobile load and desktop-to-mobile-to-desktop resizing. Screenshots are in `screenshots/`. Positions below are approximate desktop document coordinates measured from rendered heading bounds, not source animation timings. Screenshot captures can contain in-flight reveal states. The complete DOM content was inspected; visual samples span hero, about, lift, truck, aerial road, ocean, testimonials, partners, editorial, FAQ and footer. Not every animation frame or intermediate breakpoint was inspected.

Observed: isolated truck, wheels, loader, ship and aircraft are image elements; there are six canvas elements and a looping ocean MP4 element. This verifies images, canvas and video are present. It does **not** establish a particular canvas renderer, WebGL use, a frame sequence or video seeking. Smooth reverse wheel movement restored the larger ship and earlier heading composition; the menu/header reappeared when scrolling up. Exact easing, pin endpoints and camera internals are inferred from rendered movement, not verified source code.

## Reference breakdown

| Order / region | Approximate desktop placement | Composition, type, background | Observed movement / inferred mechanism |
|---|---|---|---|
| Utility strip + navigation | y0; strip ~28px, masthead ~160px | White wordmark at x29, vertical links at x367, right pill CTA. Tiny monospaced utility text. | Navigation compresses to short white bar on upward scroll; mobile has compact initials and right menu. Menu expands in dark right panel. |
| Hero | first ~1,300px; heading y315 | Dark, large illuminated globe right, headline x368 (~29vw), ~71px/75px uppercase BT Steinhart, three lines, description ~230px wide below, two 36px pills. | Globe/routes move while stationary. Scroll carries copy away. Cannot infer render method from appearance. |
| About + proof | heading y1625 through ~2700 | White; ~53px uppercase statement, small highway inset left, paragraph and huge numerical proof right. Broad empty margins. | Text reveals from pale to solid, counters count up. Omit these statistics for Navair. |
| Reach stacker / lift | ~2700–6500 | White full-width stage, photoreal cutouts occupy bottom 2/3, black ground strip. | Loader arm meets front-facing silver container, lifts it and translates. Several viewport lengths are held. Layered images verified; exact pin duration inferred. |
| Truck + services | ~6500–10500 | Side-view silver trailer, black cab above charcoal content; huge cropped pale background lettering; small speed readout. | Container changes view and settles on truck; truck/wheels travel while six service items appear below. |
| Aerial road + reliability | heading ~10879 | Road across white stage; top-view truck centered, dark panels for reliability copy. | Side to overhead composition, road markings travel, view pulls away. |
| Ocean + reasons | ~13000–16300; heading y15169 | Full blue textured ocean, enormous top-view ship becoming small, white centered heading and distributed value statements. | Ship widens then recedes; ocean continues moving. Video element verified. Clouds overlay separate image layers. |
| Aircraft + testimonials | heading y16366; through ~19000 | Returns to white. Top-view aircraft; editorial two-column portraits/quotes. | Aircraft crosses transition; quotes fade/reveal. Exact aircraft path not captured continuously. |
| Partners | ~19000–20900 | White bordered logo tiles, separate airline/shipping grids. | Logo rows/reveals. Mobile uses two columns. No Navair customers/partners assumed. |
| Insights | heading y21070 | Charcoal background, large title; list rows left/middle and image preview right. | Text reveal and image interaction inferred; no exhaustive hover audit. |
| FAQ | heading y21788 | White, intro left, eight thin-rule accordion rows right, compact email action. | Accordion affordances observed. |
| Enquiry CTA | heading y22430 | Dark large statement and round action. | Broad background transition. |
| Footer | ends ~23549 | White, 4-column directory, links, office details, map, legal baseline and enormous dotted wordmark. | Oversized wordmark; no footer box physics observed. Navair physics is a requested addition. |

### Mobile observations

At 390px, hero headline is ~47.6px, secondary headings ~35.7px. Gutters ~16px. Globe fills nearly all width behind text; headline begins ~y511. Text uses longer stacked content and a few overlaps with geography labels. Services/reliability change layout: overhead truck sits in a narrow left strip beside stacked copy; partners become two columns. Ocean ship is small and vertically centered. Footer stacks contacts, map, legal links and a two-line dotted wordmark. Reference has a large fixed awards badge; do not reproduce it. After resizing/reloading, a brief dark circular loading state precedes the hero.

## Art direction and options

Maintain uppercase wide geometric display typography, narrow mono metadata, strong white/charcoal transitions, generous negative space, isolated vehicles, long scroll holds and compact pill controls. Navair palette: charcoal #101713, paper #f1f3ec, forest #244e3c, pale lime #d8eea0, deep ocean #173b4c. Use locally bundled OFL Space Grotesk and IBM Plex Mono instead of the reference's commercial font. This is a documented visual difference.

1. Layered transparent renders + CSS: light and close to the reference's verified asset structure, but view switches/door entry require a coordinated final render pack unavailable in the repository.
2. **Chosen: one procedural Three.js world + HTML.** Actual camera orbit, crate occlusion, open doors and continuous crane handoffs solve specific depth problems. Geometry is original and provisional, replaceable with GLB factories. One canvas, capped DPR, demand rendering, no model downloads.
3. Video or image sequence: potentially photoreal but adds asset production and reverse/mobile seeking or decoded-memory cost. Not selected. No sequencing or seeking is claimed/tested.

## Eight-scene storyboard and rendering

1. **Departure / 00–15%**. Dark aerial stage. Silver aircraft with forest tail crosses left-to-right; crate NV-001 appears below flight path. HTML headline “Distance deserves direction.” Existing app accepts freight enquiries, route, cargo and timing details; describe this factual workflow, without asserting fleet ownership. Persistent enquiry and services controls.
2. **Descent / 15–31%**. Pale sky. Camera descends with lime parachute and the same timber crate, navy straps and NV-001 label. “When the stakes travel, so do we.” Three.js curved canopy/ropes; deterministic sway only.
3. **Ocean / 31–48%**. Blue sea. Crate settles on vessel deck; canopy collapses. Camera widens. Crate travels through open container doors, which close. “Across oceans. Across time zones. Never out of sight.” Three.js shared world, no swap of shipment. Journey is illustrative, not an operational tracking claim.
4. **Handoff / 48–67%**. Pale port. Gantry lifts the same closed container, traverses to truck and lowers it onto trailer. “The handoff matters as much as the destination.” Three.js; crate moves with container via same sampled transform.
5. **Inside / 67–83%**. Dark. Camera moves to the container's door axis. Hinged doors open with controlled interior lighting, revealing NV-001. “Nothing important should disappear into a process.” Three.js is justified by actual depth, perspective and occlusion.
6. **Settle / 83–100%**. Charcoal to forest. Freight scene fades, Navair wordmark and “Complex behind the scenes. Calm in front of you.” settle. HTML readable hold, no live physics.
7. **Services / normal flow**. Pale background, heading and 2 × 2 accessible linked cards. Air, sea, road, courier are provisional labels inherited from existing landing page; mark for confirmation, avoid promises. Existing enquiry action.
8. **Footer / normal flow**. Charcoal editorial contact CTA: “Global movement. Personal responsibility.” Flat labelled boxes drop into isolated Matter.js area with ground, walls, ceiling, collision, bounded dragging and reset/pause buttons. Contact/enquiry and site links are outside the play area. Oversized Navair footer type.

## Authoritative scroll mapping

One GSAP timeline controls a scalar t in [0,1]; all 3D/HTML state is derived from it, without accumulating transforms. Total pinned travel target 10 viewport heights desktop / 8 mobile, plus one stage height. Percentages are implementation decisions, **not** measurements of the reference.

| t | Shipment / vehicle state | Camera / framing | Text / handoff |
|---|---|---|---|
| 0 | Plane x=-1 to +12 over opening; crate initially hidden | Wide, oblique aircraft view, subject right | Hero fully visible at load; hold until 0.10 |
| .15 | Crate y=8; plane exits | Follow x0,y5, perspective | Descent copy enters |
| .27 | Crate y=2.3 above deck | Camera follows downward; boat starts to enter | Descent readable hold |
| .34 | Crate bottom meets deck; canopy folds | Pull back to show ship | Ocean copy enters |
| .40 | Crate translates through open container end | Wide boat/door view | Keep NV-001 visible until occluded |
| .46 | Crate inside, doors closed | Wider port view | Ocean hold ends |
| .52 | Spreader meets container roof | Ship left/truck right | Handoff copy |
| .57 | Container + enclosed crate lift | Gantry cable follows sampled roof height | No detach/recreate |
| .62 | Container traverses toward truck | Camera holds wide | Handoff remains |
| .67 | Container bottom meets trailer | Camera approaches door axis | Handoff hold |
| .75 | Doors rotate to open, internal light rises | Front perspective pushes toward opening | Inside copy |
| .83 | Label visible inside lit box | Camera stops | Inside holds, then fades |
| .90–1 | World fades | No camera motion | Navair reveal and long readable hold |

## Components and asset contract

- `src/app/page.tsx`: metadata, marketing root, semantic server-rendered services/footer content.
- `src/components/header.tsx`: route-aware homepage header without altering operational route navigation.
- `src/components/journey/Journey.tsx`: client pin, one timeline, accessible story copy, progress, reduced-motion/skip behavior, performance counters.
- `journey-state.ts`: pure progress-to-state evaluator shared by renderer/tests; endpoints/continuity independent of scroll direction.
- `journey-world.ts`: Three.js renderer, camera, lighting, transform application, on-demand rendering/disposal.
- `models.ts`: original procedural aircraft, parachute, crate, container, ship, gantry and truck factories.
- `assets.ts`: brand/dimensions/status/production manifest; stable identity NV-001.
- `PhysicsFooter.tsx`: on-demand Matter.js import, isolated fixed-step simulation, bounded pointer constraint, pause/reset, intersection/visibility suspension.
- `journey.module.css`: scoped responsive composition; existing app styles remain intact.

## Accessibility and performance

All text/links are HTML. Initial text is server rendered. Skip link targets services and transfers focus; enquiry accessible in header, hero, services, footer. Reduced motion produces a short static document containing all story text and no WebGL/physics. Renderer failure falls back to the same usable static document. Menu uses native details summary. Focus-visible states, 44px touch controls, WCAG-oriented contrast. Avoid promises of universal 60fps. Record measured local render timings, draw calls/triangles, viewport, build mode and their limits. No WebGL render loop while stationary; footer runs only in view and when not paused; cap device pixel ratio at 1.5 desktop/1.25 mobile. Dispose geometry/materials/textures, observers and timeline on unmount.

## Ordered build plan

- [ ] Write failing pure-state tests for deterministic seeking, continuous position, crate-on-deck and crane/container relationships.
- [ ] Build models/state/HTML/CSS and only plane → parachute → ship stage. Run typecheck; inspect desktop/mobile captures and reverse scroll before expanding.
- [ ] Add container loading, crane/truck, door push-in and Navair settle to same timeline.
- [ ] Add service cards, persistent enquiry actions, reduced motion/skip/fallback and bounded Matter.js footer.
- [ ] Run state tests, existing tests, typecheck and production build. Inspect desktop/mobile, reverse and fast scrolling, resize, links, keyboard, footer interaction and overflow.
- [ ] Save matching captures, measurement results, known differences and production briefs. Keep local preview running; do not deploy or send enquiries.
