#!/usr/bin/env python3
"""Build the combined Scene 01 + Scene 02 scroll-scrub demo videos."""

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SCENE_01 = ROOT / "Scene01.mp4"
SCENE_02 = Path("/Users/shauryapunj/Documents/Scene02_Rough.mp4")
OUTPUT_DIR = ROOT / "public" / "video"
DISSOLVE_SECONDS = 0.65
SCENE_01_SECONDS = 15.166666
CROSSFADE_OFFSET = SCENE_01_SECONDS - DISSOLVE_SECONDS


def build(name: str, width: int, height: int, crf: int) -> None:
    output = OUTPUT_DIR / name
    filter_graph = (
        f"[0:v]fps=30,scale={width}:{height}:flags=lanczos,"
        "setsar=1,format=yuv420p,setpts=PTS-STARTPTS[first];"
        f"[1:v]fps=30,scale={width}:{height}:flags=lanczos,"
        "setsar=1,format=yuv420p,setpts=PTS-STARTPTS[second];"
        f"[first][second]xfade=transition=fade:duration={DISSOLVE_SECONDS}:"
        f"offset={CROSSFADE_OFFSET:.6f}[video]"
    )
    command = [
        "ffmpeg", "-hide_banner", "-y",
        "-i", str(SCENE_01),
        "-i", str(SCENE_02),
        "-filter_complex", filter_graph,
        "-map", "[video]", "-an",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-r", "30",
        "-g", "4", "-keyint_min", "4", "-sc_threshold", "0",
        "-bf", "0", "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(command, check=True)


def main() -> None:
    for source in (SCENE_01, SCENE_02):
        if not source.is_file():
            raise FileNotFoundError(source)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build("journey-demo-scroll.mp4", 1920, 1080, 19)
    build("journey-demo-mobile.mp4", 960, 540, 20)


if __name__ == "__main__":
    main()
