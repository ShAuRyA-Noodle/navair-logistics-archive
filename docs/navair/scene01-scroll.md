# Scene 01 scroll integration

Replace the freight enquiry card section with the supplied Scene01.mp4 airport film. Preserve the globe/map enquiry and the footer. A sticky viewport shows the film across 380 viewport heights of scrolling; the final frame releases into the footer. Forward/reverse scroll maps to video time, with one seek in flight and the most recent target retained. Lenis already supplies the page scroll; GSAP reads the same position without adding a second smoothing layer.

The original 1440p source stays unchanged. The web derivative uses 1080p H.264, a keyframe every six frames, no audio and fast-start metadata. Load near the section, display a poster until first decode, and retain the poster on failure. Reduced-motion users get a static scene without a prolonged scroll. Portrait screens contain the landscape film to preserve the aircraft. Existing services anchors target this replacement section.

Validation: typecheck, media stream metadata, and diff checks. No automatic desktop/mobile viewport audits per user preference. Scroll decoding performance still needs hands-on review on the user's target devices.
