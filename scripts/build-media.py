#!/usr/bin/env python3
"""Rebuild the site's optimized media from the originals in media-src/.

Requires ffmpeg on PATH and Pillow 11.3+ (for AVIF):
    pip install pillow
    python3 scripts/build-media.py

Outputs are written into public/ and committed; nothing runs at deploy time.
Swap footage or photos by replacing the file in media-src/ and re-running.
"""
import pathlib
import subprocess
import tempfile

from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'media-src'
IMAGES = ROOT / 'public' / 'images'
VIDEO = ROOT / 'public' / 'video'

# The hero's former CSS filter, baked into the pixels so the browser no longer
# filters every frame: grayscale(1) brightness(.67) contrast(1.08).
GRADE = "clip((val*0.67-127.5)*1.08+127.5,0,255)"
LOOK = (
    'format=gbrp,'
    'colorchannelmixer=rr=.2126:rg=.7152:rb=.0722:gr=.2126:gg=.7152:gb=.0722:br=.2126:bg=.7152:bb=.0722,'
    f"lutrgb=r='{GRADE}':g='{GRADE}':b='{GRADE}'"
)
X264 = ['-c:v', 'libx264', '-preset', 'slower', '-crf', '32', '-profile:v', 'high', '-level', '4.0',
        '-pix_fmt', 'yuv420p', '-g', '48', '-an', '-movflags', '+faststart']
# Phones: 14s at 540-wide, CRF 34, aiming for about 1 MB. Landscape stays the longer loop.
X264_PORTRAIT = ['-c:v', 'libx264', '-preset', 'slower', '-crf', '34', '-profile:v', 'high', '-level', '4.0',
                 '-pix_fmt', 'yuv420p', '-g', '48', '-an', '-movflags', '+faststart']

# Portrait for phones; a 16:9 band for wider screens, placed low enough to keep
# the machine and the freshly mulched ground in frame for the whole loop.
HERO_VIDEOS = {
    'hero-portrait': f'fps=24,{LOOK},scale=540:-2:flags=lanczos,hqdn3d=3:3:4:4,format=yuv420p',
    'hero-landscape': f'fps=24,crop=1280:720:0:1000,{LOOK},hqdn3d=3:3:4:4,format=yuv420p',
}

# Link-preview card (also the subpage header background): a sharp full-color
# frame of the mulcher working, 1200x630.
OG_FRAME_SECONDS = 6.267
OG_CROP = 'crop=1280:672:0:1050,scale=1200:630:flags=lanczos'

GALLERY = ['before-1', 'after-1', 'before-2', 'after-2', 'before-3', 'after-3']
GALLERY_WIDTHS = (640, 800, 1000)


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def save_pair(image, stem, icc=None):
    """Write AVIF (preferred) and JPEG (fallback) versions of one image."""
    extra = {'icc_profile': icc} if icc else {}
    image.save(IMAGES / f'{stem}.avif', 'AVIF', quality=40, speed=6, **extra)
    image.save(IMAGES / f'{stem}.jpg', 'JPEG', quality=72, optimize=True, progressive=True, **extra)


def build_hero():
    source = SRC / 'hero-loop.mp4'
    with tempfile.TemporaryDirectory() as tmp:
        for name, filters in HERO_VIDEOS.items():
            out = VIDEO / f'{name}.mp4'
            codec = X264_PORTRAIT if name == 'hero-portrait' else X264
            duration = ['-t', '14'] if name == 'hero-portrait' else []
            ffmpeg('-i', str(source), *duration, '-vf', filters, *codec, str(out))
            # Poster = the video's own first frame, so the fade-in never jumps.
            frame = pathlib.Path(tmp) / f'{name}.png'
            ffmpeg('-i', str(out), '-frames:v', '1', str(frame))
            save_pair(Image.open(frame).convert('RGB'), name)
        og = pathlib.Path(tmp) / 'og.png'
        ffmpeg('-ss', str(OG_FRAME_SECONDS), '-i', str(source), '-frames:v', '1', '-vf', OG_CROP, str(og))
        Image.open(og).convert('RGB').save(IMAGES / 'og-image.jpg', 'JPEG', quality=82, optimize=True, progressive=True)


def build_gallery():
    """Export only the centered 4:3 band the gallery tiles actually show."""
    (IMAGES / 'gallery').mkdir(exist_ok=True)
    for name in GALLERY:
        original = Image.open(SRC / f'{name}.jpg')
        icc = original.info.get('icc_profile')  # iPhone photos are Display P3
        photo = ImageOps.exif_transpose(original).convert('RGB')
        band = photo.width * 3 // 4
        top = (photo.height - band) // 2
        photo = photo.crop((0, top, photo.width, top + band))
        for width in GALLERY_WIDTHS:
            resized = photo.resize((width, width * 3 // 4), Image.LANCZOS)
            save_pair(resized, f'gallery/{name}-{width}', icc)


if __name__ == '__main__':
    IMAGES.mkdir(parents=True, exist_ok=True)
    VIDEO.mkdir(parents=True, exist_ok=True)
    build_hero()
    build_gallery()
    for path in sorted([*VIDEO.glob('*'), *IMAGES.rglob('*.*')]):
        print(f'{path.relative_to(ROOT)}  {path.stat().st_size / 1024:,.0f} KB')
