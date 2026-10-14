# Responsive film: reference study and portrait production brief

14 September 2026. Scope: the approved 31.25-second departure → cloud flight → release → descent → ship arrival edit, movie-0-v4. The current landscape film remains the default.

## What the reference actually does

Inspected https://unitedcarriers.com/ in a 390×844 and 1440×900 Chrome viewport and read its publicly delivered runtime (not copied into Navair).

- The site imports Three.js, GSAP and Lenis. The globe/ocean are separate from the crane/truck machinery.
- Its `frame-sequence` runtime uses `canvas.getContext("2d")` and `drawImage` to display rendered image frames. The crane uses cover fitting; the desktop truck uses contain fitting.
- It has separate desktop/mobile crane sequences and scroll choreography. The mobile scene also composes image layers. At the inspected mobile scroll position the crane occupies an approximately 481×341 canvas and transitions into the service section; it is not simply a landscape film stretched over an entire phone screen.
- Sequence configuration uses progressive loading, a moving frame window, concurrency six, and skips some frames. These are observations, not proof of flawless performance on every device.

Reference runtime URLs observed on this date:
https://united-carriers.netlify.app/main.js
https://united-carriers.netlify.app/chunks/Home-CZ3JhV-m.js
https://united-carriers.netlify.app/chunks/frame-sequence-DVzLzLQ6.js

## Crop experiment — rejected and removed

The user rejected the full-height crop preview. It has been removed from the website, including its query switch and framing helper. The approved landscape player remains, including the smoother landing and branding correction.

At 390×844, cover fitting shows only about 26% of a 16:9 frame's width. The wide aircraft cannot fit fully inside that crop. Reframing cannot create missing scenery or change the camera. Proceed with an authored Blender camera composition instead.

## Recommended production path

Keep Blender for scene creation and cinematic rendering. Author a second camera composition using the same models, materials, lighting and animation. Keep the approved desktop movie. Use a properly composed portrait film/frame sequence on tall screens. Real-time Three.js reconstruction is not needed merely to make this fixed-camera story responsive and would entail rebuilding any Higgsfield-only scenery as actual 3D assets.

The user confirms that the Blender project and linked assets exist on the Alienware. They are not present in this Mac workspace. Before rendering: inspect their completeness and compare against the approved final Higgsfield footage. Added details in the generated video are not necessarily represented in the Blender scene.

### Handoff for the Alienware session

1. Open a copy of the original Blender project. Preserve the approved project and its existing camera/animation. Pack external resources or collect textures, HDRIs, fonts, caches and linked libraries. List missing dependencies before rendering.
2. Use the approved Scene_01, Scene_02-A and final edit as visual and timing references. Exclude Scene_02-B. Preserve aircraft identity within each approved shot, the Navair crate, gold stripe, lighting direction and color treatment. Do not invent new branding.
3. Create a separate portrait camera rig. Start at 1080×1920 and 24 fps. Check composition through an additional centered 9:20 safe frame: tall phones crop the sides of a 9:16 image. Keep essential action inside that safe frame and out of the top/bottom UI regions. Wider tablets can use the landscape rendition when that preserves more of the composition.
4. Runway/takeoff: adjust camera distance and viewing angle to fit the plane in portrait, with enough runway and sky to show motion. A closer crop of the existing broadside plane is not an acceptable substitute. Keep a readable flight direction.
5. Flight/release: show above-cloud flight before release. Keep aircraft and crate visible together at the handoff, then smoothly follow the crate. Make the release physically connected to the aircraft rather than appearing from nowhere.
6. Descent: include the full parachute canopy, suspension lines and package, then introduce the receiving ship below. Compose vertically for canopy → crate → deck continuity.
7. Arrival: preserve the soft touchdown and clear NAVAIR label. Parachutes collapse beside the crate, not over it. Use correct source materials/decals for lettering. Do not synthesize intermediate lettering with optical-flow retiming.
8. First deliver only representative stills: runway, lift-off, cloud flight, release, canopy deployment, ship approach, touchdown, settled crate. Check both 9:16 and 9:20 crops, branding and continuity before the expensive full render.
9. After stills pass, render a short low-cost motion preview to check the complete trajectory, then render original frames at final quality. Supply lossless PNG/EXR sequence plus an H.264 review movie. Keep the portrait shot durations and the final 31.25-second edit synchronized with desktop; share exact cut times/frame counts. Render enough handles for the established cloud join and landing dissolve.
10. If Higgsfield is needed to match the final landscape look, use the portrait Blender output as its composition/motion reference. Review geometry and lettering after generation; consistency is not guaranteed. Do not ask a model to invent a whole independent portrait story.

## Website integration after portrait frames arrive

- Drive both renditions from a shared normalized scroll timeline and chapter metadata.
- Select by viewport aspect ratio and delivery budget. On orientation/rendition changes, retain the visible frame until its replacement is ready and preserve story progress.
- Trial canvas playback with a bounded decoded-frame cache, prioritized target-frame loading and controlled concurrency. Benchmark against the existing short-GOP video using the actual assets; canvas is not automatically faster.
- Load only near the sequence, stop offscreen work, retain a poster/last valid frame on loading errors, and retain reduced-motion/manual playback.
- Compare visual quality, first-frame load, random seeking, reverse scrolling, decoded memory and actual-device frame pacing. Test real iOS Safari and Android Chrome, plus desktop; desktop emulation alone does not prove phone performance.
- Production rollout depends on that comparison. No claim of identical performance on every device.

Needed next: the packed Blender project and dependent assets accessible to the working session, or execution of this handoff on Alienware followed by the portrait stills/render outputs. The crop preview is retired. Establish the Blender scene quality before deciding whether any additional generated treatment is useful.
