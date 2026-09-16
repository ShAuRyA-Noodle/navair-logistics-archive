#!/usr/bin/env python3
"""Build versioned full-movie frames for the opt-in canvas comparison."""
import json
import subprocess
from PIL import Image
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/frames/movie-0-v4'
source = ROOT / 'public/video/navair-film-desktop.mp4'
metadata = json.loads((ROOT / 'public/video/navair-film.json').read_text())
variants = {}
for name, width, height in [('mobile', 960, 540), ('desktop', 1920, 1080)]:
    folder = DEST / name
    folder.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(source), '-an',
                    '-vf', f'fps=24,scale={width}:{height}:flags=lanczos',
                    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], stdout=subprocess.PIPE)
    frame_size = width * height * 3
    index = 0
    try:
        while True:
            raw = process.stdout.read(frame_size)
            if not raw:
                break
            if len(raw) != frame_size:
                raise RuntimeError('Truncated decoded frame')
            image = Image.frombytes('RGB', (width, height), raw)
            image.save(folder / f'{index:04d}.webp', format='WEBP', quality=90, method=3)
            image.close()
            index += 1
        if process.wait() != 0:
            raise RuntimeError('FFmpeg decode failed')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()
    files = sorted(folder.glob('*.webp'))
    if len(files) != round(metadata['duration'] * 24):
        raise RuntimeError(f'Unexpected frame count: {len(files)}')
    variants[name] = {'path': f'/frames/movie-0-v4/{name}', 'width': width,
                      'height': height, 'bytes': sum(p.stat().st_size for p in files)}
    print(name, len(files), variants[name], flush=True)
manifest = {'version': 'movie-0-v4', 'count': len(files), 'fps': 24,
            'duration': metadata['duration'], 'chapters': metadata['chapters'],
            'poster': metadata['poster'], 'variants': variants}
(DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
