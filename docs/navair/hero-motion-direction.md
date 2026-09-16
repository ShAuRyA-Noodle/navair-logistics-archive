# Hero motion refinement — 16 September 2026

## Reference audit

Damn Good Brands (https://damngoodbrands.com/) uses measured SVG strokes for headline highlights and navigation underlines. Its underline component animates stroke-dashoffset over approximately 1.2 seconds; navigation strokes draw in approximately 0.6 seconds. The public header also stages its entrance after the intro. Navair adapts the stroke gesture in brand gold with original paths. DGB's first-home-only localStorage intro was not copied: Navair's intro replays on every full page load.

Inspected local references:

- `Architect Design Templates/src/components/hero/hero-section.tsx`: masked line reveals, 0.7-second settling curve and short line stagger. Navair keeps the lines upright and positive tracking instead of adopting the source's rotation/tracking contraction.
- `Architect Design Templates/src/components/motion/entrance-curtain.tsx`: staged identity, completion and curtain release; the sequencing informs the loader-to-hero handoff.
- `Architect Design Templates/matr/lib/motion.ts` and `matr/components/home/hero.tsx`: measured hairlines, overshoot-free settling, differentiated scroll depth and explicit reduced-motion handling. Avoided the reference's tight negative headline spacing and expensive blur/shear effects.
- `Architect Design Templates/Poinky/artifacts/matr-flagship/src/motion/register.tsx`, `motion/plate.tsx` and `components/shell.tsx`: layered text, aperture and staggered menu patterns. These enhanced files are authored examples, not all wired into Poinky's current entry point. The globe hero uses staged lettering rather than importing the full aperture/chromatic effects.

## Implemented behavior

- Ship → aircraft → ship → truck stations around concentric rings. Gold progress stroke completes in 2.2 seconds, followed by a 0.3-second exit.
- The intro waits for the globe and the chosen film player's readiness. Video readiness means the complete blob has downloaded and loadeddata has fired; canvas readiness means a frame has been drawn.
- After five seconds visitors can enter while the film continues loading. A twelve-second film wait limit prevents indefinite waiting. Globe failure has its existing fallback. Errors also release the film readiness gate.
- Reduced-motion visitors skip the timed animation and retain explicit film playback control. Keyboard interaction behind the loader is disabled until entry.
- Upright Archivo headline with positive tracking; animated gold drawn underline; aligned text wordmark without scale-pop; navigation character rolls with drawn underlines; magnetic button content within stationary click targets.

A loading animation does not improve decoding or network speed. Slow connections can still require more than 2.5 seconds; the loader communicates that honestly without a fabricated percentage.

## Verification

TypeScript and the five sequence-loader tests pass. Chrome browser automation checked 1440, 390 and 320 pixel widths, heading overflow, visible hero actions and inline enquiry opening. Additional checks covered refresh replay, delayed-film entry, failed-video escape, reduced motion, stable logo/navigation bounds and the phone navigation's Escape behavior. These are browser viewport checks, not physical-phone benchmarks.

## Follow-up: loader synchronization and scroll choreography

The previous orbit eased nonlinearly while station delays were linear, producing a late truck highlight. The trace and orbit now run linearly over 2.2 seconds; station illumination begins at 0, 0.55, 1.1 and 1.65 seconds and settles over 0.12 seconds. The truck is fully lit at 1.77 seconds. Browser animation-time sampling verifies these positions and colors.

Lusion's current public CSS (`https://lusion.co/_astro/about.CNa9RfUh.css`, inspected 16 September 2026) uses coordinated button text/arrow transforms with a 0.3-second cubic-bezier(.4,0,.1,1) curve, rotating menu dots, and rolled menu text. Navair adapts the coordinated timing for arrows without changing hit targets. Headline lines now depart with differentiated offsets and the map-side content reveals in stages on the existing globe playhead. Both reverse with scrolling; no second smoothing loop or blur filter is introduced. Reduced-motion users retain static content.

## Loader preparation and wordmark follow-up

The circular lap now starts only after the globe, fonts and star asset have finished initial preparation. The globe remains paused behind the overlay and resumes after entry, preventing its continuous draw loop from competing with the loader. The 2.2-second lap plus 0.3-second exit is measured after preparation, so cold startup can take longer than 2.5 seconds. Browser instrumentation confirms no globe draw submissions during the lap and resumed rendering after reveal.

The navbar wordmark stays fixed while a gold route underline draws across it and the small LOGISTICS line rolls to a lighter copy on hover/focus. Reduced-motion mode disables the transitions. Refresh, delayed film, failed film and reduced-motion loader checks pass; the production build passes.
