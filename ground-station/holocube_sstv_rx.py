#!/usr/bin/env python3
"""
HOLOCUBE — SSTV audio receiver with auto-detect + multi-mode decode
BACAR-14 "Skybridge"

Continuously listens to laptop audio. When it hears an SSTV transmission
starting, it reads the mode out of the VIS header, records the full
transmission, saves the WAV, and — for the modes it has decoders for —
also decodes the image and saves a PNG. Publishes bridge state and every
detected/captured event to sstv/status so the Skybridge web tab reflects
what's coming in in real time.

    # list input devices
    python holocube_sstv_rx.py --list-devices

    # record from the default input (built-in mic)
    python holocube_sstv_rx.py --broker broker.emqx.io

    # record what's PLAYING on the laptop speakers (Windows WASAPI loopback)
    python holocube_sstv_rx.py --broker broker.emqx.io --loopback

    # a named input device (e.g. line-in from a radio interface)
    python holocube_sstv_rx.py --broker broker.emqx.io --device "CABLE Output"

Requires:
    pip install sounddevice soundfile numpy scipy Pillow paho-mqtt

How the auto-detect works:
    Every SSTV transmission starts with a ~1s VIS header:
        300 ms leader @ 1900 Hz
         10 ms break  @ 1200 Hz
        300 ms leader @ 1900 Hz
         30 ms start  @ 1200 Hz
        8 data bits × 30 ms  (1100 Hz = 1, 1300 Hz = 0, LSB first)
          1 parity bit
         30 ms stop   @ 1200 Hz
    The 8 data bits are the VIS code (Robot 36 = 0x08, Martin M1 = 0x2C,
    etc.). We keep a rolling 2-second buffer, scan for the leader
    signature, and if the surrounding structure matches, read the VIS
    bits to identify the mode. Everything after the header for that
    mode's known duration is the picture data.
"""

import argparse
import base64
import io
import json
import os
import queue
import signal
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    import numpy as np
    import sounddevice as sd
    import soundfile as sf
    from PIL import Image
except ImportError as exc:
    sys.exit(
        "missing deps (%s). Install with:\n"
        "    pip install sounddevice soundfile numpy scipy Pillow paho-mqtt" % exc
    )

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

# ============================================================
# CONSTANTS
# ============================================================
STATUS_TOPIC          = "sstv/status"
DEFAULT_SAMPLE_RATE   = 44100
DEFAULT_OUT_DIR       = "sstv_rx"
POST_DETECT_TAIL_S    = 2.0     # extra seconds after mode duration (safety margin)
THUMB_MAX_SIDE        = 320     # base64 preview embedded in MQTT stays small

# SSTV mode registry — populated per VIS code.
# label / seconds / lines / decoder key.
@dataclass
class SstvMode:
    vis:       int
    key:       str
    label:     str
    seconds:   float
    lines:     int
    width:     int
    decoder:   Optional[str] = None    # 'robot36' | 'martinm1' | None

MODES = {
    0x08: SstvMode(0x08, 'robot36',   'Robot 36',    36.0,  240, 320, 'robot36'),
    0x0C: SstvMode(0x0C, 'robot72',   'Robot 72',    72.0,  240, 320, None),
    0x20: SstvMode(0x20, 'martinm2',  'Martin M2',   58.0,  256, 320, None),
    0x2C: SstvMode(0x2C, 'martinm1',  'Martin M1',   114.0, 256, 320, 'martinm1'),
    0x38: SstvMode(0x38, 'scottieS2', 'Scottie S2',  71.0,  256, 320, None),
    0x3C: SstvMode(0x3C, 'scottieS1', 'Scottie S1',  110.0, 256, 320, None),
    0x4C: SstvMode(0x4C, 'scottieDX', 'Scottie DX',  269.0, 256, 320, None),
    0x5D: SstvMode(0x5D, 'pd50',      'PD 50',       50.0,  496, 640, None),
    0x63: SstvMode(0x63, 'pd90',      'PD 90',       90.0,  496, 640, None),
    0x5F: SstvMode(0x5F, 'pd120',     'PD 120',      120.0, 496, 640, None),
    0x60: SstvMode(0x60, 'pd160',     'PD 160',      160.0, 496, 640, None),
    0x61: SstvMode(0x61, 'pd180',     'PD 180',      180.0, 496, 640, None),
    0x62: SstvMode(0x62, 'pd240',     'PD 240',      240.0, 496, 640, None),
    0x71: SstvMode(0x71, 'pd290',     'PD 290',      290.0, 616, 800, None),
}

running = True


def _handle_sigint(_sig, _frame):
    global running
    running = False


# ============================================================
# SIGNAL PROCESSING
# ============================================================

def goertzel_power(samples, sample_rate, target_freq):
    """Goertzel filter — power at target_freq for a chunk of samples.
    Faster than FFT when you only need one frequency."""
    n = len(samples)
    if n == 0:
        return 0.0
    k = int(0.5 + n * target_freq / sample_rate)
    w = 2.0 * np.pi * k / n
    cw = np.cos(w)
    coeff = 2.0 * cw
    q0, q1, q2 = 0.0, 0.0, 0.0
    for s in samples:
        q0 = coeff * q1 - q2 + s
        q2 = q1
        q1 = q0
    # magnitude squared
    return q1 * q1 + q2 * q2 - q1 * q2 * coeff


def dominant_freq_fft(samples, sample_rate, lo=1000, hi=2500):
    """FFT-based peak-frequency finder in a band. Returns Hz."""
    if len(samples) == 0:
        return 0.0
    windowed = samples * np.hanning(len(samples))
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(samples), 1.0 / sample_rate)
    mask = (freqs >= lo) & (freqs <= hi)
    if not mask.any():
        return 0.0
    idx = np.argmax(spectrum[mask])
    return float(freqs[mask][idx])


def freq_to_pixel(freq):
    """SSTV FSK: 1500 Hz = black (0), 2300 Hz = white (255)."""
    if freq < 1500:
        return 0
    if freq > 2300:
        return 255
    return int(round((freq - 1500) / 800.0 * 255))


# ============================================================
# VIS HEADER DETECTOR
# ============================================================

class VISDetector:
    """Fed audio chunks. On demand, scans a rolling window for the VIS
    header signature. Returns (mode, header_end_sample_offset) when
    the leader/break/leader/start-bit/VIS-bits pattern matches, else None.
    header_end_sample_offset is measured from the CURRENT buffer end,
    i.e. how many samples ago the header finished — used to line the
    recorder up on the first line of picture data."""

    LEADER_FREQ = 1900
    BREAK_FREQ  = 1200
    BIT_FREQS   = {1: 1100, 0: 1300}

    LEADER_MS = 300
    BREAK_MS  = 10
    BIT_MS    = 30
    HEADER_MS = 300 + 10 + 300 + 30 + 8 * 30 + 30 + 30   # ≈ 940 ms

    def __init__(self, sample_rate):
        self.sr = sample_rate
        self.buf = np.zeros(0, dtype=np.float32)
        self.leader_n = int(sample_rate * self.LEADER_MS / 1000)
        self.break_n  = int(sample_rate * self.BREAK_MS  / 1000)
        self.bit_n    = int(sample_rate * self.BIT_MS    / 1000)
        self.header_n = int(sample_rate * self.HEADER_MS / 1000)
        self.buf_max  = int(sample_rate * 3)             # keep 3 s
        self.scan_stride = int(sample_rate * 0.05)       # 50 ms hop
        self.last_scan_pos = 0
        self.cooldown_until = 0.0                        # wall time

    def feed(self, chunk):
        chunk = chunk.reshape(-1).astype(np.float32)
        self.buf = np.concatenate([self.buf, chunk])
        if len(self.buf) > self.buf_max:
            drop = len(self.buf) - self.buf_max
            self.buf = self.buf[drop:]
            self.last_scan_pos = max(0, self.last_scan_pos - drop)

    def scan(self):
        """Returns (SstvMode, end_index_in_current_buffer) or None."""
        if time.time() < self.cooldown_until:
            return None
        if len(self.buf) < self.header_n + self.leader_n:
            return None

        end = len(self.buf) - self.header_n
        pos = self.last_scan_pos
        while pos < end:
            if self._is_leader_at(pos):
                mode = self._read_vis(pos)
                if mode is not None:
                    header_end = pos + self.header_n
                    self.last_scan_pos = header_end
                    # Cool down for at least the header window so we don't
                    # re-trigger on the same start.
                    self.cooldown_until = time.time() + 1.0
                    return mode, header_end
            pos += self.scan_stride
        self.last_scan_pos = end
        return None

    def _is_leader_at(self, pos):
        """Check the leader-break-leader pattern starting at pos."""
        seg1 = self.buf[pos : pos + self.leader_n]
        seg_b = self.buf[pos + self.leader_n : pos + self.leader_n + self.break_n]
        seg2 = self.buf[pos + self.leader_n + self.break_n : pos + 2 * self.leader_n + self.break_n]
        if len(seg2) < self.leader_n:
            return False
        f1 = dominant_freq_fft(seg1, self.sr, 1600, 2100)
        f2 = dominant_freq_fft(seg2, self.sr, 1600, 2100)
        fb = dominant_freq_fft(seg_b, self.sr, 1100, 1300)
        # Tolerances kept loose because loopback recording drift is real.
        return (
            abs(f1 - self.LEADER_FREQ) < 80 and
            abs(f2 - self.LEADER_FREQ) < 80 and
            abs(fb - self.BREAK_FREQ)  < 80
        )

    def _read_vis(self, leader_start):
        """After the second leader and 30 ms start bit, read the 8 VIS
        bits LSB-first at 30 ms each. Returns SstvMode or None."""
        vis_start = (
            leader_start
            + self.leader_n         # first leader
            + self.break_n          # break
            + self.leader_n         # second leader
            + self.bit_n            # start bit
        )
        bits = []
        for i in range(8):
            seg = self.buf[vis_start + i * self.bit_n : vis_start + (i + 1) * self.bit_n]
            if len(seg) < self.bit_n:
                return None
            f = dominant_freq_fft(seg, self.sr, 1000, 1400)
            bits.append(1 if abs(f - 1100) < abs(f - 1300) else 0)

        vis = 0
        for i, b in enumerate(bits):
            vis |= (b << i)

        mode = MODES.get(vis)
        if mode is not None:
            return mode

        # If the byte we read isn't a known VIS code, try masking the
        # parity bit off (VIS is 7 bits + parity in some tables).
        return MODES.get(vis & 0x7F)


# ============================================================
# IMAGE DECODERS
# ============================================================

class DecoderError(RuntimeError):
    pass


def _lines_to_image(pixels, width, height):
    arr = np.array(pixels, dtype=np.uint8).reshape(height, width, 3)
    return Image.fromarray(arr, mode="RGB")


def _line_frequencies(audio, sample_rate, count, samples_per_bin):
    """Split `audio` into `count` equal bins and return the dominant
    frequency in each. Used to map an FSK-encoded scan line to pixel values."""
    freqs = np.zeros(count, dtype=np.float32)
    for i in range(count):
        start = int(round(i * samples_per_bin))
        end   = int(round((i + 1) * samples_per_bin))
        if end > len(audio):
            break
        seg = audio[start:end]
        # For per-pixel granularity, Goertzel at the expected max/min carrier
        # doesn't help — we want the *dominant* frequency. Use a small FFT.
        freqs[i] = dominant_freq_fft(seg, sample_rate, 1400, 2400)
    return freqs


def decode_robot36(audio, sample_rate):
    """Robot 36 — 240 lines × 150 ms. YRYBY chrominance:
        Y always;  odd lines send R-Y,  even lines send B-Y."""
    line_ms = 150.0
    line_n = int(sample_rate * line_ms / 1000)
    # Line layout (approx, ms):  9 sync + 3 porch + 88 Y + 4.5 sync + 1.5 porch + 44 chroma
    y_start_ms  = 9 + 3
    y_end_ms    = y_start_ms + 88
    c_start_ms  = y_end_ms + 4.5 + 1.5
    c_end_ms    = c_start_ms + 44

    def ms_slice(line_audio, start_ms, end_ms):
        s = int(sample_rate * start_ms / 1000)
        e = int(sample_rate * end_ms / 1000)
        return line_audio[s:e]

    width = 320
    height = 240
    # Working YCbCr planes
    y_plane  = np.zeros((height, width), dtype=np.float32)
    ry_plane = np.zeros((height // 2 + 1, width), dtype=np.float32)
    by_plane = np.zeros((height // 2 + 1, width), dtype=np.float32)

    total_needed = line_n * height
    if len(audio) < total_needed:
        # Pad with silence — better a truncated image than a crash.
        audio = np.concatenate([audio, np.zeros(total_needed - len(audio), dtype=np.float32)])

    for row in range(height):
        line = audio[row * line_n : (row + 1) * line_n]
        y_bin = ms_slice(line, y_start_ms, y_end_ms)
        c_bin = ms_slice(line, c_start_ms, c_end_ms)
        y_freqs = _line_frequencies(y_bin, sample_rate, width, len(y_bin) / width)
        c_freqs = _line_frequencies(c_bin, sample_rate, width, len(c_bin) / width)
        for x in range(width):
            y_plane[row, x] = freq_to_pixel(y_freqs[x])
        if row % 2 == 0:
            for x in range(width):
                ry_plane[row // 2, x] = freq_to_pixel(c_freqs[x])
        else:
            for x in range(width):
                by_plane[row // 2, x] = freq_to_pixel(c_freqs[x])

    # Convert YCrCb (approx) -> RGB. R-Y and B-Y centered at 128.
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    for row in range(height):
        ry = ry_plane[row // 2]
        by = by_plane[row // 2]
        y  = y_plane[row]
        r = y + 1.402 * (ry - 128)
        b = y + 1.772 * (by - 128)
        g = y - 0.344 * (by - 128) - 0.714 * (ry - 128)
        rgb[row, :, 0] = np.clip(r, 0, 255)
        rgb[row, :, 1] = np.clip(g, 0, 255)
        rgb[row, :, 2] = np.clip(b, 0, 255)
    return Image.fromarray(rgb, mode="RGB")


def decode_martinm1(audio, sample_rate):
    """Martin M1 — 256 lines × 446.446 ms, sequential G/B/R channels
    each 146.432 ms. Sync 4.862 ms + porch 0.572 ms per line."""
    line_ms = 446.446
    line_n  = int(sample_rate * line_ms / 1000)

    sync_ms      = 4.862
    porch_ms     = 0.572
    ch_ms        = 146.432
    green_start  = sync_ms + porch_ms
    blue_start   = green_start + ch_ms + porch_ms
    red_start    = blue_start  + ch_ms + porch_ms

    width  = 320
    height = 256
    rgb = np.zeros((height, width, 3), dtype=np.uint8)

    total_needed = line_n * height
    if len(audio) < total_needed:
        audio = np.concatenate([audio, np.zeros(total_needed - len(audio), dtype=np.float32)])

    def slice_ms(line, start_ms, dur_ms):
        s = int(sample_rate * start_ms / 1000)
        e = int(sample_rate * (start_ms + dur_ms) / 1000)
        return line[s:e]

    for row in range(height):
        line = audio[row * line_n : (row + 1) * line_n]
        g_bin = slice_ms(line, green_start, ch_ms)
        b_bin = slice_ms(line, blue_start,  ch_ms)
        r_bin = slice_ms(line, red_start,   ch_ms)
        g_f = _line_frequencies(g_bin, sample_rate, width, len(g_bin) / width)
        b_f = _line_frequencies(b_bin, sample_rate, width, len(b_bin) / width)
        r_f = _line_frequencies(r_bin, sample_rate, width, len(r_bin) / width)
        for x in range(width):
            rgb[row, x, 0] = freq_to_pixel(r_f[x])
            rgb[row, x, 1] = freq_to_pixel(g_f[x])
            rgb[row, x, 2] = freq_to_pixel(b_f[x])
    return Image.fromarray(rgb, mode="RGB")


DECODERS = {
    'robot36':  decode_robot36,
    'martinm1': decode_martinm1,
}


# ============================================================
# MQTT
# ============================================================

def make_mqtt_client(broker, port):
    if mqtt is None:
        print("[rx] paho-mqtt not installed — running without MQTT publish")
        return None
    client = mqtt.Client(client_id=f"holocube-sstv-rx-{int(time.time())}")
    client.will_set(
        STATUS_TOPIC,
        json.dumps({"event": "offline", "status": "offline", "role": "receiver",
                    "t": int(time.time() * 1000)}),
        qos=0, retain=False,
    )
    try:
        client.connect(broker, port, keepalive=30)
        client.loop_start()
    except Exception as exc:
        print(f"[rx] MQTT connect failed ({exc}) — continuing without publish")
        return None
    return client


def publish(client, payload):
    if client is None:
        return
    try:
        client.publish(STATUS_TOPIC, json.dumps(payload), qos=0)
    except Exception:
        pass


# ============================================================
# AUDIO CAPTURE
# ============================================================

def resolve_device(name_or_index):
    if name_or_index is None:
        return None
    if isinstance(name_or_index, int):
        return name_or_index
    if name_or_index.isdigit():
        return int(name_or_index)
    needle = name_or_index.lower()
    for i, dev in enumerate(sd.query_devices()):
        if needle in dev["name"].lower():
            return i
    raise SystemExit(f"no device matched {name_or_index!r}. Try --list-devices.")


def resolve_loopback_device():
    if sys.platform != "win32":
        raise SystemExit("--loopback is Windows-only. Use a PulseAudio/PipeWire monitor on Linux.")
    apis = sd.query_hostapis()
    wasapi = next((i for i, a in enumerate(apis) if a["name"] == "Windows WASAPI"), None)
    if wasapi is None:
        raise SystemExit("Windows WASAPI host API not available.")
    default_out = apis[wasapi]["default_output_device"]
    if default_out < 0:
        raise SystemExit("no default WASAPI output device — plug in speakers/set default.")
    return default_out


def build_stream(device, sample_rate, loopback):
    kwargs = {"samplerate": sample_rate, "channels": 1, "dtype": "float32", "device": device}
    if loopback:
        kwargs["extra_settings"] = sd.WasapiSettings(loopback=True)
    return sd.InputStream(**kwargs)


def list_devices():
    print(sd.query_devices())
    print()
    print("Host APIs:")
    for i, api in enumerate(sd.query_hostapis()):
        print(f"  [{i}] {api['name']}  (default_input={api['default_input_device']})")


# ============================================================
# MAIN LOOP
# ============================================================

def base64_thumbnail(image, max_side=THUMB_MAX_SIDE):
    thumb = image.copy()
    thumb.thumbnail((max_side, max_side), Image.BICUBIC)
    buf = io.BytesIO()
    thumb.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def record(args):
    signal.signal(signal.SIGINT, _handle_sigint)
    device = resolve_loopback_device() if args.loopback else resolve_device(args.device)
    device_info = sd.query_devices(device) if device is not None else sd.query_devices(kind="input")
    device_name = device_info["name"]
    source_kind = "loopback" if args.loopback else "input"

    print(f"[rx] listening on ({source_kind}) {device_name}")
    print(f"[rx] sample_rate={args.sample_rate}  out={args.out_dir}")
    print(f"[rx] modes with built-in decoders: {[m.label for m in MODES.values() if m.decoder]}")
    print(f"[rx] mode auto-detect: reads VIS header from any SSTV start")

    mqtt_client = make_mqtt_client(args.broker, args.port) if args.broker else None
    publish(mqtt_client, {
        "event": "online", "status": "online", "role": "receiver",
        "device": device_name, "source": source_kind,
        "sample_rate": args.sample_rate, "t": int(time.time() * 1000),
        "listening_for": [m.label for m in MODES.values()],
    })

    os.makedirs(args.out_dir, exist_ok=True)

    detector = VISDetector(args.sample_rate)
    q = queue.Queue()

    def audio_cb(indata, _frames, _time_info, status):
        if status:
            # over/underruns are logged but don't stop us
            pass
        q.put(indata.copy())

    stream = build_stream(device, args.sample_rate, args.loopback)
    stream.start()

    try:
        recording_mode = None      # SstvMode when we've locked on
        recording_buf = []         # list of ndarrays after the header
        recording_target_n = 0
        recording_have_n = 0

        while running:
            try:
                samples = q.get(timeout=0.5)
            except queue.Empty:
                continue

            if recording_mode is None:
                # Idle — feed the detector and scan for a start.
                detector.feed(samples)
                hit = detector.scan()
                if hit is not None:
                    recording_mode, header_end = hit
                    print(f"[rx] SSTV detected — mode={recording_mode.label} (VIS 0x{recording_mode.vis:02X})")
                    publish(mqtt_client, {
                        "event":  "detected", "status": "detected", "role": "receiver",
                        "mode":   recording_mode.key, "mode_label": recording_mode.label,
                        "vis":    f"0x{recording_mode.vis:02X}",
                        "seconds": recording_mode.seconds,
                        "t":      int(time.time() * 1000),
                    })
                    # Everything after header_end in the detector buffer is
                    # the first slice of picture data.
                    picture_tail = detector.buf[header_end:].copy()
                    recording_buf = [picture_tail]
                    recording_have_n = len(picture_tail)
                    recording_target_n = int(args.sample_rate * (recording_mode.seconds + POST_DETECT_TAIL_S))
            else:
                # Actively capturing picture data.
                recording_buf.append(samples.reshape(-1))
                recording_have_n += len(samples)
                if recording_have_n >= recording_target_n:
                    audio = np.concatenate(recording_buf, axis=0).astype(np.float32)
                    mode = recording_mode
                    recording_mode = None
                    recording_buf = []
                    recording_have_n = 0
                    _handle_capture(audio, mode, args, device_name, source_kind, mqtt_client)
    finally:
        stream.stop()
        stream.close()
        publish(mqtt_client, {
            "event": "offline", "status": "offline", "role": "receiver",
            "t": int(time.time() * 1000),
        })
        if mqtt_client is not None:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
        print("[rx] stopped")


def _handle_capture(audio, mode: SstvMode, args, device_name, source_kind, mqtt_client):
    stamp = time.strftime("%Y%m%d_%H%M%S")
    wav_path = os.path.join(args.out_dir, f"sstv_rx_{stamp}_{mode.key}.wav")
    sf.write(wav_path, audio, args.sample_rate, subtype="PCM_16")
    wav_size = os.path.getsize(wav_path)
    duration_s = round(len(audio) / args.sample_rate, 1)

    payload = {
        "event":       "captured", "status": "captured", "role": "receiver",
        "device":      device_name, "source": source_kind,
        "mode":        mode.key,
        "mode_label":  mode.label,
        "vis":         f"0x{mode.vis:02X}",
        "wav_path":    wav_path,
        "wav_bytes":   wav_size,
        "duration_s":  duration_s,
        "t":           int(time.time() * 1000),
    }

    decoder = DECODERS.get(mode.decoder) if mode.decoder else None
    if decoder is not None:
        try:
            img = decoder(audio, args.sample_rate)
            png_path = os.path.splitext(wav_path)[0] + ".png"
            img.save(png_path, format="PNG", optimize=True)
            payload["image_path"] = png_path
            payload["image_bytes"] = os.path.getsize(png_path)
            payload["thumbnail"] = base64_thumbnail(img)
            print(f"[rx] {mode.label} — saved {wav_path} + {png_path}")
        except Exception as exc:
            payload["decode_error"] = str(exc)
            print(f"[rx] {mode.label} — saved {wav_path} (decode failed: {exc})")
    else:
        payload["decode_note"] = f"No built-in decoder for {mode.label}. Open the WAV in MMSSTV."
        print(f"[rx] {mode.label} — saved {wav_path} (no built-in decoder for this mode)")

    publish(mqtt_client, payload)


def main():
    parser = argparse.ArgumentParser(description="HOLOCUBE SSTV audio receiver (auto-detect + multi-mode)")
    parser.add_argument("--broker", help="MQTT broker host (optional; runs standalone otherwise)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT TCP port (default 1883)")
    parser.add_argument("--device", help="Input device name (partial match) or index. Omit for the default input.")
    parser.add_argument("--loopback", action="store_true",
                        help="Windows WASAPI: record what's playing to the speakers.")
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE,
                        help=f"Capture sample rate (default {DEFAULT_SAMPLE_RATE})")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR,
                        help=f"Directory to save captured WAV/PNG files (default {DEFAULT_OUT_DIR})")
    parser.add_argument("--list-devices", action="store_true",
                        help="Print available audio devices and exit.")
    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        return

    record(args)


if __name__ == "__main__":
    main()
