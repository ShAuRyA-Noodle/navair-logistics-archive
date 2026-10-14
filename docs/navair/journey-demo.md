# Journey demo media

`journey-demo-scroll.mp4` and `journey-demo-mobile.mp4` combine the complete Scene 01 airport departure with the complete Scene 02 above-clouds flight. The shots overlap in a subtle 0.65-second dissolve from 14.517s through 15.167s, producing a 39.500-second, frame-aligned timeline without black frames.

Both web derivatives are silent H.264 at 30 fps with a keyframe every four frames, no B-frames, and fast-start metadata for responsive scroll scrubbing. Desktop is 1920×1080 at CRF 19; mobile is 960×540 at CRF 20. Use `scene01-poster.jpg` as the poster.

Rebuild from the repository root with `python3 scripts/build-journey-demo.py`. The script expects `Scene01.mp4` in the repository root and `/Users/shauryapunj/Documents/Scene02_Rough.mp4` as the second source.
