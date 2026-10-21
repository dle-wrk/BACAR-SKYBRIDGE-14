#!/usr/bin/env python3
"""
BACAR-14 Skybridge — image → timelapse batcher
Drop this script into a folder full of mission images and run it:

    python timelapse.py

It groups the images 1000 at a time (sorted naturally by filename)
and renders each group as one MP4 where every image is held for
0.15 s → 1000 × 0.15 s = 2.5 minutes of footage per output. If you
have 17 h of captures that's ~16 700 images → ~17 clips.

Output lands in ./timelapse_out/ as timelapse_0001.mp4,
timelapse_0002.mp4, … so re-running skips chunks that already rendered.

Requires:
    ffmpeg on PATH (https://ffmpeg.org/download.html).
    Pillow ONLY if you pass --telemetry (pip install pillow).

Flags:
    --batch N        images per clip (default 1000)
    --seconds-per-image N   hold time per image in seconds (default 0.15)
    --ext jpg,png    extensions to include (default jpg,jpeg,png)
    --out DIR        output directory (default ./timelapse_out)
    --crf N          H.264 quality (lower = better, default 23)
    --width N        resize longest side (default: keep original)
    --telemetry PATH burn mission telemetry on each frame (needs
                     Pillow). Matches each image to the row of the CSV
                     where `photos` cumulative count reaches that index,
                     and overlays uptime / die temp / photo count /
                     free SD in the bottom-left.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def natural_key(name: str):
    """Sort IMG_2, IMG_10 as (2, 10) not ('10', '2')."""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r'(\d+)', name)]


def ensure_ffmpeg() -> str:
    ff = shutil.which('ffmpeg')
    if not ff:
        sys.exit(
            "ERROR: ffmpeg isn't on PATH.\n"
            "  Windows:  winget install ffmpeg   (or download from ffmpeg.org)\n"
            "  macOS:    brew install ffmpeg\n"
            "  Linux:    sudo apt install ffmpeg"
        )
    return ff


def gather_images(root: Path, exts: list[str]) -> list[Path]:
    exts_lower = {e.lower().lstrip('.') for e in exts}
    out = [
        p for p in root.iterdir()
        if p.is_file() and p.suffix.lower().lstrip('.') in exts_lower
    ]
    out.sort(key=lambda p: natural_key(p.name))
    return out


def load_telemetry(path: Path) -> list[dict]:
    """Read the mission telemetry CSV into a list of dicts. Expects at
    minimum: up_s, photos, die_C, free_mb (the other columns are shown
    if present but not required)."""
    with path.open('r', encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def match_telemetry_row(rows: list[dict], image_index: int) -> dict | None:
    """Find the telemetry row whose cumulative `photos` count has just
    reached image_index+1 (i.e. the row recorded right after that image
    was captured). Rows are 60 s apart so a 1-image granularity match
    produces a smoothly-advancing uptime/temp overlay."""
    if not rows:
        return None
    target = image_index + 1
    chosen = rows[0]
    for row in rows:
        try:
            if int(row.get('photos') or 0) >= target:
                chosen = row
                break
        except ValueError:
            continue
        chosen = row
    return chosen


def format_uptime(seconds_str: str) -> str:
    try:
        s = int(seconds_str)
    except (TypeError, ValueError):
        return seconds_str or ''
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"T+{h:02d}:{m:02d}:{s:02d}"


def overlay_text_for(row: dict | None, image_index: int, total_images: int) -> list[str]:
    if not row:
        return [f"image {image_index + 1} / {total_images}"]
    lines = []
    lines.append(format_uptime(row.get('up_s', '')))
    photos = row.get('photos')
    if photos:
        lines.append(f"photo {int(photos):>5d}   #{image_index + 1}/{total_images}")
    tdie = row.get('die_C')
    free = row.get('free_mb')
    bits = []
    if tdie:
        try: bits.append(f"die {float(tdie):.1f}°C")
        except ValueError: pass
    if free:
        try: bits.append(f"SD {int(free)/1024:.2f} GB free")
        except ValueError: pass
    if bits:
        lines.append('   '.join(bits))
    # Only surface failures if non-zero to keep the overlay quiet during
    # the mission's happy path.
    fails = []
    for k in ('cam_fail', 'sd_fail', 'sd_remounts', 'skipped'):
        try:
            v = int(row.get(k, 0) or 0)
            if v:
                fails.append(f"{k}:{v}")
        except ValueError:
            pass
    if fails:
        lines.append(' '.join(fails))
    return lines


def render_overlay(src: Path, dst: Path, lines: list[str], footer: str = '') -> None:
    """Burn text onto a copy of `src` → `dst`. White text with a dark
    semitransparent panel behind it. Falls back to the PIL default
    bitmap font if no TTF is reachable."""
    from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError  # local import so Pillow is only required with --telemetry

    # Mission images are occasionally truncated (power cuts, SD remounts).
    # Fall back to a copy so a bad frame doesn't abort the whole chunk.
    try:
        img = Image.open(src)
        img.load()
        img = img.convert('RGB')
    except (UnidentifiedImageError, OSError) as exc:
        print(f"    ! skipping bad frame {src.name}: {exc}", file=sys.stderr)
        shutil.copy2(src, dst)
        return
    w, h = img.size
    draw = ImageDraw.Draw(img, 'RGBA')
    # Pick a font size proportional to the image; fall back to default.
    font_px = max(14, h // 32)
    font = None
    for candidate in (
        'C:/Windows/Fonts/consola.ttf',
        'C:/Windows/Fonts/arial.ttf',
        '/System/Library/Fonts/Menlo.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    ):
        try:
            font = ImageFont.truetype(candidate, font_px)
            break
        except (OSError, IOError):
            continue
    if font is None:
        font = ImageFont.load_default()

    pad = max(6, font_px // 2)
    all_lines = list(lines) + ([footer] if footer else [])
    # Measure block
    sizes = [draw.textbbox((0, 0), ln, font=font) for ln in all_lines]
    line_h = max((b[3] - b[1]) for b in sizes) + max(2, font_px // 6)
    block_w = max((b[2] - b[0]) for b in sizes) + pad * 2
    block_h = line_h * len(all_lines) + pad * 2

    x0, y0 = pad, h - block_h - pad
    draw.rectangle([x0, y0, x0 + block_w, y0 + block_h], fill=(0, 0, 0, 160))
    ty = y0 + pad
    for ln in all_lines:
        # Thin dark stroke behind the text for extra legibility.
        draw.text((x0 + pad, ty), ln, font=font, fill=(255, 255, 255, 255),
                  stroke_width=max(1, font_px // 14), stroke_fill=(0, 0, 0, 220))
        ty += line_h

    img.save(dst, quality=92)


def write_concat_list(chunk: list[Path], seconds_per_image: float, list_path: Path) -> None:
    """ffmpeg's concat demuxer takes a text file of
       file '…'
       duration N
    entries, and the LAST file has to appear twice without a duration
    (an ffmpeg quirk — otherwise the final frame has 0 duration)."""
    with list_path.open('w', encoding='utf-8') as f:
        for img in chunk:
            # Use absolute POSIX path so Windows backslashes don't trip the parser.
            safe = str(img.resolve()).replace("'", r"'\''")
            f.write(f"file '{safe}'\n")
            f.write(f"duration {seconds_per_image}\n")
        # Required duplicate of the last entry (no duration line).
        last = str(chunk[-1].resolve()).replace("'", r"'\''")
        f.write(f"file '{last}'\n")


def encode_chunk(ffmpeg: str, list_file: Path, out_path: Path, crf: int, width: int | None) -> None:
    vf = []
    if width:
        # Keep aspect, round to even (H.264 needs even dims).
        vf.append(f"scale='min({width},iw)':-2")
    vf_arg = ['-vf', ','.join(vf)] if vf else []
    cmd = [
        ffmpeg, '-y',
        '-f', 'concat', '-safe', '0',
        '-i', str(list_file),
        *vf_arg,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', str(crf),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-fflags', '+genpts',
        '-vsync', 'vfr',
        str(out_path),
    ]
    print(f"  ffmpeg → {out_path.name}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-2000:])
        raise SystemExit(f"ffmpeg failed on {out_path.name}")


def human_duration(seconds: float) -> str:
    s = int(round(seconds))
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def main() -> int:
    ap = argparse.ArgumentParser(description="Batch image timelapse maker.")
    ap.add_argument('--batch', type=int, default=1000,
                    help='Images per output clip (default 1000).')
    ap.add_argument('--seconds-per-image', type=float, default=0.15,
                    help='How long each image is held, in seconds (default 0.15 — 1000 × 0.15 s = 2.5 min clips).')
    ap.add_argument('--ext', default='jpg,jpeg,png',
                    help='Comma-separated image extensions to include (default jpg,jpeg,png).')
    ap.add_argument('--out', default='timelapse_out',
                    help='Output directory (default ./timelapse_out).')
    ap.add_argument('--crf', type=int, default=23,
                    help='H.264 quality (lower is better, 18-28 typical, default 23).')
    ap.add_argument('--width', type=int, default=None,
                    help='Resize longest side to N pixels (keeps aspect; default: no resize).')
    ap.add_argument('--source', default='.',
                    help='Folder containing images (default: current dir, i.e. the folder this script sits in).')
    ap.add_argument('--telemetry', default=None,
                    help='Mission telemetry CSV to burn onto each frame (needs Pillow).')
    args = ap.parse_args()

    ffmpeg = ensure_ffmpeg()

    root = Path(args.source).resolve()
    if not root.is_dir():
        sys.exit(f"ERROR: source folder not found: {root}")

    out_dir = (root / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    list_dir = out_dir / '_lists'
    list_dir.mkdir(exist_ok=True)

    exts = [e.strip() for e in args.ext.split(',') if e.strip()]
    images = gather_images(root, exts)
    if not images:
        sys.exit(f"No images with extensions {exts} found in {root}")

    # Optional telemetry overlay — only pulls Pillow in when asked for.
    telemetry_rows = None
    if args.telemetry:
        tpath = Path(args.telemetry)
        if not tpath.is_absolute():
            tpath = (root / tpath).resolve()
        if not tpath.is_file():
            sys.exit(f"ERROR: telemetry file not found: {tpath}")
        try:
            from PIL import Image  # noqa: F401 — fail early if Pillow is missing
        except ImportError:
            sys.exit("ERROR: --telemetry needs Pillow. Install with: pip install pillow")
        telemetry_rows = load_telemetry(tpath)
        print(f"Telemetry:     {tpath}  ({len(telemetry_rows)} rows)")

    batch = max(1, args.batch)
    chunks = [images[i:i + batch] for i in range(0, len(images), batch)]

    total_sec = args.seconds_per_image * len(images)
    print(f"Source folder: {root}")
    print(f"Images found:  {len(images)} ({', '.join(exts)})")
    print(f"Batch size:    {batch} images → "
          f"{human_duration(batch * args.seconds_per_image)} per clip "
          f"at {args.seconds_per_image}s/image")
    print(f"Output folder: {out_dir}")
    print(f"Clips to make: {len(chunks)} "
          f"(≈ {human_duration(total_sec)} of footage total)")
    print()

    total_images = len(images)
    for i, chunk in enumerate(chunks, start=1):
        out_path = out_dir / f"timelapse_{i:04d}.mp4"
        if out_path.exists() and out_path.stat().st_size > 0:
            print(f"[{i}/{len(chunks)}] exists, skipping: {out_path.name}")
            continue
        print(f"[{i}/{len(chunks)}] {len(chunk)} images → "
              f"{human_duration(len(chunk) * args.seconds_per_image)}")

        # When telemetry is on, render each image to a per-chunk tmp dir
        # with the overlay burned in, then concat those. Low disk pressure
        # (300 × ~45 KB ≈ 14 MB per chunk) and cleaned up after encode.
        temp_dir = None
        source_images = chunk
        if telemetry_rows is not None:
            temp_dir = Path(tempfile.mkdtemp(prefix=f"tl_overlay_{i:04d}_", dir=str(out_dir)))
            print(f"  overlaying telemetry → {temp_dir.name}")
            overlaid = []
            for j, src in enumerate(chunk):
                global_index = (i - 1) * batch + j
                row = match_telemetry_row(telemetry_rows, global_index)
                lines = overlay_text_for(row, global_index, total_images)
                dst = temp_dir / src.name
                render_overlay(src, dst, lines, footer='BACAR-14 Skybridge · HoloCube')
                overlaid.append(dst)
            source_images = overlaid

        list_file = list_dir / f"list_{i:04d}.txt"
        write_concat_list(source_images, args.seconds_per_image, list_file)
        try:
            encode_chunk(ffmpeg, list_file, out_path, args.crf, args.width)
        finally:
            if temp_dir and temp_dir.is_dir():
                shutil.rmtree(temp_dir, ignore_errors=True)

    print()
    print(f"Done. {len(chunks)} clip(s) in {out_dir}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
