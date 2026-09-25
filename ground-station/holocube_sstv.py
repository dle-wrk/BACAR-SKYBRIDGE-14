#!/usr/bin/env python3
"""
HOLOCUBE — SSTV bridge
BACAR-14 "Skybridge"

Take Skybridge cube images off MQTT (or off disk) and re-transmit them as
SSTV audio. Writes a .wav per image and can play it out immediately so it
lands in your radio via VB-CABLE.

    MQTT image topic  ────────► SSTV .wav ────────► VB-CABLE ────► radio TX
    (bacar/skybridge14/+/image)

Encoders (from pysstv / colaclanth's library):
    robot36    — 36 s, 320x240, best default for a HAB image feed
    robot72    — 72 s, 320x240, cleaner but slower
    martinm1   — 114 s, 320x256, high quality when time permits
    scottieS1  — 110 s, 320x256, alternative
    pd120      — 126 s, 640x496, colour, popular on ISS SSTV

    live:   python holocube_sstv.py --broker localhost --topic 'bacar/skybridge14/+/image'
    file:   python holocube_sstv.py --file rx_images/img_001.jpg --mode martinm1
    play:   add --play to auto-play each generated .wav (Windows only)

Requires:
    pip install paho-mqtt pysstv Pillow

Windows-to-radio audio: install VB-CABLE (https://vb-audio.com/Cable/), set
your default playback device to CABLE Input, patch CABLE Output to your
radio's mic input. Then run with --play.
"""

import argparse
import base64
import io
import json
import os
import sys
import time

from PIL import Image

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

from pysstv.color import Robot36, Robot72, MartinM1, ScottieS1, PasokonP3
try:
    from pysstv.color import PD120
except ImportError:
    PD120 = None

MODES = {
    "robot36": Robot36,
    "robot72": Robot72,
    "martinm1": MartinM1,
    "scottieS1": ScottieS1,
    "pasokonP3": PasokonP3,
}
if PD120 is not None:
    MODES["pd120"] = PD120

SAMPLE_RATE = 44100
BITS = 16
OUT_DIR_DEFAULT = "sstv_out"


def resize_for_mode(img: Image.Image, mode_cls) -> Image.Image:
    """SSTV encoders demand exact width x height per mode. Fit-and-pad."""
    target_w, target_h = mode_cls.WIDTH, mode_cls.HEIGHT
    src = img.convert("RGB")
    src_ratio = src.width / src.height
    tgt_ratio = target_w / target_h
    if src_ratio > tgt_ratio:
        new_w = target_w
        new_h = int(round(target_w / src_ratio))
    else:
        new_h = target_h
        new_w = int(round(target_h * src_ratio))
    resized = src.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def encode_to_wav(img_bytes: bytes, mode_name: str, wav_path: str) -> None:
    if mode_name not in MODES:
        raise ValueError(f"unknown mode {mode_name!r}, pick one of: {', '.join(MODES)}")
    mode_cls = MODES[mode_name]
    img = Image.open(io.BytesIO(img_bytes))
    img = resize_for_mode(img, mode_cls)
    sstv = mode_cls(img, SAMPLE_RATE, BITS)
    sstv.write_wav(wav_path)


def maybe_play(wav_path: str) -> None:
    """Play the .wav in the background (Windows). Non-blocking so multiple
    images can queue via the radio without the script freezing."""
    if os.name != "nt":
        print(f"[sstv] --play only works on Windows; wav ready at {wav_path}")
        return
    import winsound  # noqa: WPS433
    winsound.PlaySound(wav_path, winsound.SND_FILENAME | winsound.SND_ASYNC)


def extract_image_bytes(payload: bytes):
    """Payloads on Skybridge cube image topics are one of:
      - raw JPEG bytes (binary)
      - a bare URL string
      - a data URL string (data:image/jpeg;base64,...)
      - a JSON envelope: {schema:'bacar.nrf.image.v1', image:{data,mime_type}}
    Returns bytes, or None if we can't extract."""
    if payload[:2] == b"\xff\xd8":  # JPEG SOI marker
        return payload

    text = payload.decode("utf-8", errors="ignore").strip()
    if not text:
        return None

    if text.startswith("{") or text.startswith("["):
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            return None
        image = obj.get("image") if isinstance(obj, dict) else None
        for src in (image, obj):
            if not isinstance(src, dict):
                continue
            data = src.get("data") or src.get("image_data")
            if isinstance(data, str) and data.strip():
                if data.startswith("data:"):
                    return base64.b64decode(data.split(",", 1)[1])
                try:
                    return base64.b64decode(data)
                except (ValueError, TypeError):
                    pass
            url = src.get("url") or src.get("image_url")
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                return fetch_url(url)
        return None

    if text.startswith("data:"):
        return base64.b64decode(text.split(",", 1)[1])
    if text.startswith(("http://", "https://")):
        return fetch_url(text)

    return None


def fetch_url(url: str):
    try:
        from urllib.request import urlopen
        with urlopen(url, timeout=15) as resp:
            return resp.read()
    except Exception as exc:  # noqa: BLE001
        print(f"[sstv] fetch failed for {url}: {exc}")
        return None


def cube_id_from_topic(topic: str) -> str:
    # bacar/skybridge14/cubeC/image -> cubeC
    parts = topic.split("/")
    return parts[-2] if len(parts) >= 2 else "cube"


def process_image(payload: bytes, mode: str, out_dir: str, cube: str, play: bool):
    img_bytes = extract_image_bytes(payload)
    if img_bytes is None:
        print(f"[sstv] {cube}: could not extract JPEG from payload")
        return
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    wav_path = os.path.join(out_dir, f"{cube}_{stamp}_{mode}.wav")
    print(f"[sstv] {cube}: encoding {len(img_bytes)} bytes -> {wav_path} ({mode})")
    encode_to_wav(img_bytes, mode, wav_path)
    print(f"[sstv] {cube}: wrote {wav_path}")
    if play:
        maybe_play(wav_path)


def run_mqtt(broker: str, port: int, topic: str, mode: str, out_dir: str, play: bool):
    if mqtt is None:
        sys.exit("[sstv] paho-mqtt not installed. Run: pip install paho-mqtt")

    def on_connect(client, _userdata, _flags, rc):
        if rc == 0:
            client.subscribe(topic, qos=1)
            print(f"[sstv] subscribed to {topic} on {broker}:{port}")
        else:
            print(f"[sstv] connect failed rc={rc}")

    def on_message(_client, _userdata, msg):
        cube = cube_id_from_topic(msg.topic)
        try:
            process_image(msg.payload, mode, out_dir, cube, play)
        except Exception as exc:  # noqa: BLE001
            print(f"[sstv] {cube}: encode error: {exc}")

    client = mqtt.Client(client_id=f"holocube-sstv-{int(time.time())}")
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(broker, port, keepalive=60)
    print(f"[sstv] bridging to SSTV mode={mode} out_dir={out_dir} play={play}")
    client.loop_forever()


def run_file(path: str, mode: str, out_dir: str, play: bool):
    with open(path, "rb") as fh:
        payload = fh.read()
    cube = os.path.splitext(os.path.basename(path))[0]
    process_image(payload, mode, out_dir, cube, play)


def main():
    parser = argparse.ArgumentParser(description="HOLOCUBE SSTV bridge")
    parser.add_argument("--broker", default="localhost", help="MQTT broker host (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--topic", default="bacar/skybridge14/+/image",
                        help="MQTT topic to subscribe to (default covers all cubes)")
    parser.add_argument("--file", help="Encode a single local image file instead of subscribing to MQTT")
    parser.add_argument("--mode", default="robot36", choices=list(MODES.keys()),
                        help="SSTV mode to encode with (default: robot36)")
    parser.add_argument("--out-dir", default=OUT_DIR_DEFAULT,
                        help=f"Directory for generated .wav files (default: {OUT_DIR_DEFAULT})")
    parser.add_argument("--play", action="store_true",
                        help="Play each .wav after encoding (Windows only, uses default audio device)")
    args = parser.parse_args()

    if args.file:
        run_file(args.file, args.mode, args.out_dir, args.play)
    else:
        run_mqtt(args.broker, args.port, args.topic, args.mode, args.out_dir, args.play)


if __name__ == "__main__":
    main()
