"""Generate original web frame assets without storing intermediate uncompressed frames."""
import subprocess
from pathlib import Path
from PIL import Image
process = subprocess.Popen(['ffmpeg','-v','error','-i','Scene01.mp4','-an','-vf','scale=1440:810','-f','rawvideo','-pix_fmt','rgb24','-'], stdout=subprocess.PIPE)
size = 1440 * 810 * 3
index = 0
while True:
    data = process.stdout.read(size)
    if not data: break
    if len(data) != size: raise RuntimeError('Incomplete decoded frame')
    image = Image.frombytes('RGB', (1440,810), data)
    for name, frame in [('desktop', image), ('mobile', image.resize((960,540), Image.Resampling.LANCZOS))]:
        destination = Path('public/frames/scene01') / name
        destination.mkdir(parents=True, exist_ok=True)
        frame.save(destination / f'{index:04d}.webp', 'WEBP', quality=82, method=4)
    index += 1
if process.wait(): raise RuntimeError('Frame extraction failed')
print(f'Generated {index} frames per variant')
