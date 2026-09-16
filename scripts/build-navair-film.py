#!/usr/bin/env python3
"""Reproducible Movie_0 edit; source files are never modified.

Usage: python3 scripts/build-navair-film.py [--source-dir /path/to/Movie_0]
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/video'
FPS = 24
RELEASE_IN = 0  # Preserve all of Scene 02-A, including its flight above the clouds.
TRANSITION = 20 / FPS
LANDING_CUT = 313 / FPS
LANDING_BLEND = 9 / FPS
LANDING_STRETCH = 1.75


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=duration,nb_frames,width,height,r_frame_rate',
        '-of', 'json', str(path)], text=True))['streams'][0]


def run(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, default=ROOT.parent / 'Movie_0')
    args = parser.parse_args()
    first = args.source_dir / 'Scene_01.mp4'
    second = next(p for p in args.source_dir.glob('*.mp4') if p.name.strip() == 'Scene_02-A.mp4')
    first_info, second_info = probe(first), probe(second)
    first_duration = int(first_info['nb_frames']) / FPS
    offset = first_duration - TRANSITION
    OUTPUT.mkdir(parents=True, exist_ok=True)
    review = ROOT / 'docs/navair/movie-review'
    review.mkdir(parents=True, exist_ok=True)
    veil = review / 'cloud-veil.jpg'
    run('-ss', 3.5, '-i', second, '-vf', 'crop=iw:400:0:1040,scale=1440:810,gblur=sigma=18', '-frames:v', 1, veil)
    run('-i', first, '-vf', 'scale=1920:1080', '-frames:v', 1, '-q:v', 2, OUTPUT / 'navair-film-poster.jpg')

    for name, width, height, crf, keyint in [
        ('desktop', 1920, 1080, 19, 3),
        ('mobile', 960, 540, 19, 2),
    ]:
        graph = (
            f'[0:v]fps={FPS},scale={width}:{height}:flags=lanczos,setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[a];'
            f'[1:v]trim=start={RELEASE_IN:.8f},fps={FPS},scale={width}:{height}:flags=lanczos,setsar=1,format=yuv420p,'
            'eq=saturation=0.94:gamma=1.025,settb=AVTB,setpts=PTS-STARTPTS,split=2[flight][arrival];'
            f'[flight]trim=end={LANDING_CUT:.8f},setpts=PTS-STARTPTS[flightEnd];'
            f'[arrival]trim=start={LANDING_CUT:.8f},setpts=PTS-STARTPTS,'
            f'setpts={LANDING_STRETCH}*PTS,fps={FPS},settb=AVTB[softArrival];'
            f'[flightEnd][softArrival]xfade=transition=fade:duration={LANDING_BLEND:.8f}:'
            f'offset={LANDING_CUT - LANDING_BLEND:.8f}[b];'
            f'[a][b]xfade=transition=fade:duration={TRANSITION:.8f}:offset={offset:.8f}[cut];'
            f'[2:v]scale={width}:{height},format=rgba,'
            f'fade=t=in:st={offset:.8f}:d={TRANSITION / 2:.8f}:alpha=1,'
            f'fade=t=out:st={offset + TRANSITION / 2:.8f}:d={TRANSITION / 2:.8f}:alpha=1[cloud];'
            '[cut][cloud]overlay=shortest=1:format=auto,format=yuv420p,tpad=stop_mode=clone:stop_duration=0.75[out]'
        )
        run('-i', first, '-i', second, '-loop', 1, '-framerate', FPS, '-i', veil,
            '-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libx264',
            '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', FPS,
            '-g', keyint, '-keyint_min', keyint, '-sc_threshold', 0, '-bf', 0,
            '-movflags', '+faststart', OUTPUT / f'navair-film-{name}.mp4')
        print(f'{name}: {(OUTPUT / f"navair-film-{name}.mp4").stat().st_size / 1048576:.1f} MiB', flush=True)

    actual = probe(OUTPUT / 'navair-film-desktop.mp4')
    metadata = {
        'version': 'movie-0-v4', 'fps': FPS,
        'duration': int(actual['nb_frames']) / FPS,
        'transition': {'start': offset, 'end': first_duration, 'type': 'source-cloud-occlusion'},
        'chapters': [
            {'time': 0, 'label': '01 / DEPARTURE', 'title': 'Distance deserves direction.'},
            {'time': offset, 'label': '02 / IN TRANSIT', 'title': 'Every handoff matters.'},
            {'time': offset + 9.0, 'label': '03 / AIR TO SEA', 'title': 'A clear way forward.'},
            {'time': offset + 13.0, 'label': '04 / ARRIVAL', 'title': 'Ready for what comes next.'}
        ],
        'sources': {'desktop': '/video/navair-film-desktop.mp4', 'mobile': '/video/navair-film-mobile.mp4'},
        'poster': '/video/navair-film-poster.jpg',
        'edit': {'scene01': first.name, 'scene02': second.name.strip(), 'scene02In': RELEASE_IN, 'landingCut': LANDING_CUT, 'landingBlend': LANDING_BLEND, 'landingStretch': LANDING_STRETCH, 'scene02BUsed': False}
    }
    (OUTPUT / 'navair-film.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    main()
