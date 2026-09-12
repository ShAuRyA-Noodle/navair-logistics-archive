# Original asset manifest and production handoff

All procedural objects in the prototype are original geometry authored for this project and **provisional artwork**, not finished photoreal assets. No reference artwork is downloaded or reused. Source of truth: `src/components/journey/assets.ts` and factories in `models.ts`.

| Asset | Required views / format | Prototype production | Final production brief |
|---|---|---|---|
| Aircraft | oblique top, side, underside; GLB | Lathed fuselage, extruded wings, four nacelles, tail and decals | Generic four-engine cargo aircraft, no manufacturer markings. White satin paint, forest tail, Navair wordmark. Model wing camber, cockpit glazing, panel seams. <70k triangles, ≤2K PBR textures, ≤3MB compressed. Flight axis +X. |
| NV-001 crate | every side, top and front inside container; GLB | Timber box, raised battens, straps, branded label | Same 1.15 × 1.05 × 1.0 world-unit box throughout. Warm plywood, forest straps, ivory shipping label NV-001. No customer data. <8k triangles, 1K atlas. Pivot at centre. |
| Parachute | oblique canopy, side descent, collapsed canopy; GLB with morph | Hemisphere panels and ropes | Pale lime canopy with forest panel, 8 suspension lines attached to crate corners. Inflation and collapse morphs; rope anchors exposed. Visual story metaphor, not representation of ordinary freight handling. |
| Container | side, rear, open interior, overhead; GLB | Ribbed shell, two separately pivoted doors, frame, lock bars | Forest steel shell, ivory Navair side mark, NV-001 door marking. External 4.8 × 2.1 × 2.0 world units. Local door axis +X; left/right hinges named doorLeft/doorRight. Interior floor, door seals, corrugated sides. <35k triangles, 2K atlas, ≤2MB. |
| Ship | wide three-quarter, deck landing area; GLB | Extruded hull, bridge, rails, deck stacks | Generic feeder cargo vessel. Warm white bridge, graphite hull, coordinated forest/grey containers. Preserve open deck-to-container path and deck y datum from factory. No invented ownership or fleet claims. <60k triangles. |
| Gantry | wide port, suspended container; GLB | Structural steel beams, wheels, cable lines, spreader | Forest port gantry, structural bracing, actual cable attachment points matching container corners. Separate trolley and spreader meshes. <25k triangles. |
| Truck | side/oblique, trailer end; GLB | Cab, glazing, chassis, wheels | Graphite generic road tractor; trailer matches container support datum. Real wheel/rim detail, mirrors, lights and plate with no fake registration. <40k triangles. |
| Ocean | horizon/oblique surface; procedural shader | Bounded analytic geometry, deterministic progress ripples | If final realism needs texture: license tileable ocean normal map, ≤1K. No video seeking. Keep sea movement subordinate to readability. |
| Footer cartons | front square; HTML/CSS | Flat paper boxes with labels/tape | Retain flat design for Matter.js; optional own 512px WebP texture, no perspective. |
| Wordmark | HTML/vector | Space Grotesk uppercase with custom arrow symbol | Brand-owner review of final Navair lettering. No commercial reference font copied. |

## Replacing models

Factories return Three.Group objects with explicit pivots and named door/canopy subgroups. Keep world dimensions in the manifest and normalise new models to those bounds. Replace only the relevant factory; retain the same sampled world transforms and NV-001 identity. For GLB loading introduce a loader/cache in the world constructor, with progress/failure fallback and deterministic ready-state rendering. Current assets are procedural, so the prototype does not include an untested GLB loader.

## Business verification before publication

Air freight, sea freight, road freight and courier labels come from the previous landing page. All four remain provisional pending owner verification of actual availability and regions. Confirm legal business identity, real email/phone/address, privacy text and brand assets before publication. Prototype contact action uses the existing enquiry route; no invented phone, email, customers, statistics or certifications appear.
