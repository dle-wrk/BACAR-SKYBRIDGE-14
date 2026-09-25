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
    """Fed audio chunks. On demand, scans a rolling buffer for the SSTV
    start signature. Returns (mode, buffer_index_just_after_header) or None.

    Header shape we accept (matches both the strict Martin/Wraase spec
    and the simpler shape pysstv/most modern encoders emit):

        ≥ 200 ms  of 1900 Hz leader
        30 ms     of 1200 Hz start bit
        8 × 30 ms VIS bits (1100 Hz = 1, 1300 Hz = 0, LSB first)
        30 ms     even-parity bit
        30 ms     of 1200 Hz stop bit

    The strict spec has a 10 ms 1200 Hz break in the middle of the leader,
    but we don't require it — accepting both means one detector works for
    real HAM transmissions and synthetic pysstv test files alike."""

    LEADER_FREQ = 1900
    START_FREQ  = 1200
    BIT_MS      = 30
    MIN_LEADER_MS = 200
    # 8 vis + parity + stop after the start bit
    POST_START_MS = 10 * 30

    def __init__(self, sample_rate):
        self.sr = sample_rate
        self.buf = np.zeros(0, dtype=np.float32)
        self.bit_n     = int(sample_rate * self.BIT_MS / 1000)
        self.leader_n  = int(sample_rate * self.MIN_LEADER_MS / 1000)
        self.post_n    = int(sample_rate * self.POST_START_MS / 1000)
        # We need at least leader + start + 10 VIS/parity/stop bits in the
        # buffer to attempt a decode.
        self.header_n  = self.leader_n + self.bit_n + self.post_n
        self.buf_max   = int(sample_rate * 4)             # 4 s rolling window
        self.scan_stride = int(sample_rate * 0.015)       # 15 ms hop
        self.last_scan_pos = 0
        self.cooldown_until = 0.0                          # wall time

    def feed(self, chunk):
        chunk = chunk.reshape(-1).astype(np.float32)
        self.buf = np.concatenate([self.buf, chunk])
        if len(self.buf) > self.buf_max:
            drop = len(self.buf) - self.buf_max
            self.buf = self.buf[drop:]
            self.last_scan_pos = max(0, self.last_scan_pos - drop)

    def scan(self):
        """Slide across the buffer looking for start bit transitions."""
        if time.time() < self.cooldown_until:
            return None
        if len(self.buf) < self.header_n:
            return None

        end = len(self.buf) - self.post_n
        pos = max(self.leader_n, self.last_scan_pos)
        while pos < end:
            # Candidate start-bit position: 30 ms of 1200 Hz preceded by
            # ≥200 ms of 1900 Hz leader.
            if self._is_start_at(pos) and self._is_leader_before(pos):
                mode = self._read_vis_after(pos)
                if mode is not None:
                    # header_end = start bit end + 10 * bit_n (VIS+parity+stop)
                    header_end = pos + self.bit_n + self.post_n
                    self.last_scan_pos = header_end
                    self.cooldown_until = time.time() + 1.0
                    return mode, header_end
            pos += self.scan_stride
        self.last_scan_pos = end
        return None

    def _is_start_at(self, pos):
        seg = self.buf[pos : pos + self.bit_n]
        if len(seg) < self.bit_n:
            return False
        f = dominant_freq_fft(seg, self.sr, 1000, 1500)
        return abs(f - self.START_FREQ) < 80

    def _is_leader_before(self, pos):
        """Check that the 200 ms immediately before pos is dominantly 1900 Hz.
        Sample two windows so we don't get fooled by a single stray bin."""
        for offset_ms in (60, 140):
            check_start = pos - int(self.sr * offset_ms / 1000)
            if check_start < 0:
                return False
            seg = self.buf[check_start : check_start + int(self.sr * 0.06)]
            f = dominant_freq_fft(seg, self.sr, 1500, 2200)
            if abs(f - self.LEADER_FREQ) > 100:
                return False
        return True

    def _read_vis_after(self, start_bit_pos):
        """Read the 8 VIS bits following the start bit (LSB first)."""
        vis_start = start_bit_pos + self.bit_n
        bits = []
        for i in range(8):
            seg = self.buf[vis_start + i * self.bit_n : vis_start + (i + 1) * self.bit_n]
            if len(seg) < self.bit_n:
                return None
            f = dominant_freq_fft(seg, self.sr, 1000, 1400)
            # 1100 Hz => 1, 1300 Hz => 0
            bits.append(1 if abs(f - 1100) < abs(f - 1300) else 0)

        vis = 0
        for i, b in enumerate(bits):
            vis |= (b << i)

        # Try the raw byte first (some transmissions use the full 8-bit code
        # index directly), then the low 7 bits (parity stripped).
        return MODES.get(vis) or MODES.get(vis & 0x7F)


# ============================================================
# IMAGE DECODERS
# ============================================================

class DecoderError(RuntimeError):
    pass


def _lines_to_image(pixels, width, height):
    arr = np.array(pixels, dtype=np.uint8).reshape(height, width, 3)
    return Image.fromarray(arr, mode="RGB")


def hilbert_analytic(x):
    """Analytic signal (Hilbert transform) via FFT — numpy-only.
    Returns a complex-valued array of the same length as x. Used to
    compute instantaneous frequency for FSK demod."""
    n = len(x)
    fft = np.fft.fft(x)
    h = np.zeros(n)
    if n % 2 == 0:
        h[0] = h[n // 2] = 1
        h[1 : n // 2] = 2
    else:
        h[0] = 1
        h[1 : (n + 1) // 2] = 2
    return np.fft.ifft(fft * h)


def instantaneous_freq(x, sample_rate):
    """Sample-by-sample frequency estimate of an FSK-encoded signal.
    Returns a real array of the same length as x."""
    z = hilbert_analytic(x)
    phase = np.unwrap(np.angle(z))
    df = np.diff(phase) * sample_rate / (2.0 * np.pi)
    return np.concatenate([[df[0]], df]).astype(np.float32)


def sample_line(freqs_1d, sample_rate, start_ms, end_ms, out_width):
    """Slice the given instantaneous-frequency track between two ms
    offsets and average it down to `out_width` bins — one per pixel."""
    s = int(round(sample_rate * start_ms / 1000.0))
    e = int(round(sample_rate * end_ms / 1000.0))
    seg = freqs_1d[s:e]
    if len(seg) == 0:
        return np.zeros(out_width, dtype=np.float32)
    # np.linspace + interpolation would work but the vectorised bucketing
    # below is faster and gives equivalent results at these bin sizes.
    edges = np.linspace(0, len(seg), out_width + 1).astype(int)
    out = np.empty(out_width, dtype=np.float32)
    for i in range(out_width):
        chunk = seg[edges[i] : edges[i + 1]]
        out[i] = float(np.mean(chunk)) if len(chunk) else 0.0
    return out


def decode_robot36(audio, sample_rate):
    """Robot 36 — 240 lines × 150 ms.
      Line format (ms):
         0..9     sync         @ 1200 Hz
         9..12    porch
        12..100   88 ms Y      (320 px)
       100..104.5 narrow sync  @ 1500 Hz separator
       104.5..106 porch
       106..150  44 ms chroma  (160 px — half-width, sub-sampled)
      Chroma alternates per line:
         even rows  →  R-Y
         odd rows   →  B-Y
      Missing chroma channel per row is copied from the nearest neighbour."""
    line_ms  = 150.0
    line_n   = int(sample_rate * line_ms / 1000)
    width, height = 320, 240
    chroma_w = 160

    total_needed = line_n * height
    if len(audio) < total_needed:
        audio = np.concatenate([audio, np.zeros(total_needed - len(audio), dtype=np.float32)])
    audio = audio[:total_needed]

    freqs = instantaneous_freq(audio, sample_rate)

    y_plane  = np.zeros((height, width),    dtype=np.float32)
    ry_plane = np.zeros((height, chroma_w), dtype=np.float32)
    by_plane = np.zeros((height, chroma_w), dtype=np.float32)
    have_ry  = np.zeros(height, dtype=bool)
    have_by  = np.zeros(height, dtype=bool)

    for row in range(height):
        row_freqs = freqs[row * line_n : (row + 1) * line_n]
        y_freqs   = sample_line(row_freqs, sample_rate, 12,    100,   width)
        c_freqs   = sample_line(row_freqs, sample_rate, 106.5, 149.5, chroma_w)
        y_pixels  = np.vectorize(freq_to_pixel)(y_freqs)
        c_pixels  = np.vectorize(freq_to_pixel)(c_freqs)
        y_plane[row] = y_pixels
        # Robot 36 sends R-Y on ODD lines and B-Y on EVEN lines (pysstv
        # encoding matches this convention). The other assignment produces
        # colour-inverted output — verified against a colour-bar test.
        if row % 2 == 1:
            ry_plane[row] = c_pixels
            have_ry[row] = True
        else:
            by_plane[row] = c_pixels
            have_by[row] = True

    # Fill missing R-Y and B-Y rows from the nearest neighbour that has data.
    for row in range(height):
        if not have_ry[row]:
            ry_plane[row] = ry_plane[max(0, row - 1)] if row > 0 else ry_plane[row + 1]
        if not have_by[row]:
            by_plane[row] = by_plane[max(0, row - 1)] if row > 0 else by_plane[row + 1]

    # Upsample chroma horizontally to full width.
    ry_full = np.repeat(ry_plane, 2, axis=1)
    by_full = np.repeat(by_plane, 2, axis=1)

    # YCbCr → RGB with R-Y / B-Y centred at 128.
    y   = y_plane
    ryc = ry_full - 128.0
    byc = by_full - 128.0
    r   = y + 1.402 * ryc
    b   = y + 1.772 * byc
    g   = y - 0.344 * byc - 0.714 * ryc
    rgb = np.stack([np.clip(r, 0, 255), np.clip(g, 0, 255), np.clip(b, 0, 255)], axis=2)
    return Image.fromarray(rgb.astype(np.uint8), mode="RGB")


def decode_martinm1(audio, sample_rate):
    """Martin M1 — 256 lines × 446.446 ms, sequential G / B / R each
    146.432 ms. Sync 4.862 ms + porch 0.572 ms per line."""
    line_ms  = 446.446
    line_n   = int(sample_rate * line_ms / 1000)
    width, height = 320, 256

    sync_ms   = 4.862
    porch_ms  = 0.572
    ch_ms     = 146.432
    green_start = sync_ms + porch_ms
    blue_start  = green_start + ch_ms + porch_ms
    red_start   = blue_start  + ch_ms + porch_ms

    total_needed = line_n * height
    if len(audio) < total_needed:
        audio = np.concatenate([audio, np.zeros(total_needed - len(audio), dtype=np.float32)])
    audio = audio[:total_needed]
    freqs = instantaneous_freq(audio, sample_rate)

    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    for row in range(height):
        row_freqs = freqs[row * line_n : (row + 1) * line_n]
        g_f = sample_line(row_freqs, sample_rate, green_start, green_start + ch_ms, width)
        b_f = sample_line(row_freqs, sample_rate, blue_start,  blue_start  + ch_ms, width)
        r_f = sample_line(row_freqs, sample_rate, red_start,   red_start   + ch_ms, width)
        rgb[row, :, 0] = np.vectorize(freq_to_pixel)(r_f)
        rgb[row, :, 1] = np.vectorize(freq_to_pixel)(g_f)
        rgb[row, :, 2] = np.vectorize(freq_to_pixel)(b_f)
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
