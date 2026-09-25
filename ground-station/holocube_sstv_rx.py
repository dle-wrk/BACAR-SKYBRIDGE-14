#!/usr/bin/env python3
"""
HOLOCUBE — SSTV audio receiver
BACAR-14 "Skybridge"

Captures audio from a laptop input device and saves rolling WAV files so
external SSTV transmissions (pico balloons, ISS SSTV, HAMs on the pass)
can be reviewed and decoded off-line in MMSSTV / QSSTV / an online decoder.

Publishes bridge state to sstv/status so the Skybridge web dashboard's
SSTV tab flips to RECEIVER ONLINE and lists each new capture.

    # list input devices you can record from
    python holocube_sstv_rx.py --list-devices

    # record from the default input (typically the built-in mic)
    python holocube_sstv_rx.py --broker broker.emqx.io

    # record what's PLAYING through the laptop speakers
    # (Windows WASAPI loopback — needs no cables, no Stereo Mix hack)
    python holocube_sstv_rx.py --broker broker.emqx.io --loopback

    # record from a specific device by name (partial match)
    python holocube_sstv_rx.py --broker broker.emqx.io --device "CABLE Output"

Requires:
    pip install sounddevice soundfile numpy paho-mqtt

sounddevice ships with PortAudio bundled on Windows — no separate install.
"""

import argparse
import json
import os
import queue
import signal
import sys
import time

try:
    import numpy as np
    import sounddevice as sd
    import soundfile as sf
except ImportError as exc:
    sys.exit(
        "missing audio deps (%s). Install with:\n"
        "    pip install sounddevice soundfile numpy paho-mqtt" % exc
    )

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

STATUS_TOPIC          = "sstv/status"
DEFAULT_SAMPLE_RATE   = 44100
DEFAULT_CHUNK_SECONDS = 60          # one WAV file per minute of audio
DEFAULT_OUT_DIR       = "sstv_rx"

running = True


def _handle_sigint(_sig, _frame):
    global running
    running = False


def list_devices():
    """Print every audio device sounddevice can see, both input and loopback
    capable, so the operator can pick one for --device."""
    print(sd.query_devices())
    print()
    print("Host APIs:")
    for i, api in enumerate(sd.query_hostapis()):
        print(f"  [{i}] {api['name']}  (default_input={api['default_input_device']})")


def resolve_device(name_or_index):
    """Turn --device 'partial name' or an integer index into the concrete
    sounddevice device id sounddevice accepts."""
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
    """Find the default output device index for WASAPI loopback capture
    (records what the laptop is playing). Windows only."""
    if sys.platform != "win32":
        raise SystemExit("--loopback is Windows-only. On other OSes route "
                         "audio via a virtual loopback (e.g. PulseAudio monitor).")
    # Find the WASAPI host API
    apis = sd.query_hostapis()
    wasapi = next((i for i, a in enumerate(apis) if a["name"] == "Windows WASAPI"), None)
    if wasapi is None:
        raise SystemExit("Windows WASAPI host API not found in sounddevice.")
    default_out = apis[wasapi]["default_output_device"]
    if default_out < 0:
        raise SystemExit("no default WASAPI output device found. Plug in speakers or set a default.")
    return default_out


def build_input_stream(device, sample_rate, loopback):
    """Build the sounddevice.InputStream that yields audio chunks.
    Loopback mode captures the playback of the chosen output device instead
    of a microphone — WASAPI extra_settings does the magic."""
    kwargs = {
        "samplerate": sample_rate,
        "channels":   1,
        "dtype":      "float32",
    }
    if loopback:
        kwargs["device"] = device
        kwargs["extra_settings"] = sd.WasapiSettings(loopback=True)
    else:
        kwargs["device"] = device
    return sd.InputStream(**kwargs)


def make_mqtt_client(broker, port):
    if mqtt is None:
        print("paho-mqtt not installed - continuing without MQTT publish")
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
        print(f"MQTT connect failed ({exc}) - continuing without publish")
        return None
    return client


def publish(client, payload):
    if client is None:
        return
    try:
        client.publish(STATUS_TOPIC, json.dumps(payload), qos=0)
    except Exception:
        pass  # never let a broker hiccup kill the recorder


def audio_rms(samples):
    """Root-mean-square level of a chunk. Useful as a poor-man's VU meter
    so the web dashboard can show a channel is actually hearing something."""
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples))))


def audio_peak_db(samples):
    if samples.size == 0:
        return -120.0
    peak = float(np.max(np.abs(samples)))
    if peak <= 0:
        return -120.0
    return round(20.0 * np.log10(peak), 1)


def record(args):
    signal.signal(signal.SIGINT, _handle_sigint)

    device = resolve_loopback_device() if args.loopback else resolve_device(args.device)
    device_info = sd.query_devices(device) if device is not None else sd.query_devices(kind="input")
    device_name = device_info["name"]
    source_kind = "loopback" if args.loopback else "input"

    print(f"[rx] recording from ({source_kind}) {device_name}")
    print(f"[rx] chunk={args.chunk_seconds}s  sample_rate={args.sample_rate}  out={args.out_dir}")

    mqtt_client = make_mqtt_client(args.broker, args.port) if args.broker else None
    publish(mqtt_client, {
        "event":       "online",
        "status":      "online",
        "role":        "receiver",
        "device":      device_name,
        "source":      source_kind,
        "sample_rate": args.sample_rate,
        "chunk_s":     args.chunk_seconds,
        "t":           int(time.time() * 1000),
    })

    os.makedirs(args.out_dir, exist_ok=True)
    q = queue.Queue()

    def callback(indata, _frames, _time_info, _status):
        # Copy — the buffer is reused by PortAudio
        q.put(indata.copy())

    stream = build_input_stream(device, args.sample_rate, args.loopback)
    stream.start()

    try:
        while running:
            chunk_start = time.time()
            stamp = time.strftime("%Y%m%d_%H%M%S")
            wav_path = os.path.join(args.out_dir, f"sstv_rx_{stamp}.wav")
            buffer = []
            try:
                while running and (time.time() - chunk_start) < args.chunk_seconds:
                    try:
                        samples = q.get(timeout=0.5)
                        buffer.append(samples)
                    except queue.Empty:
                        continue
            except Exception as exc:
                print(f"[rx] audio read error: {exc}")
                publish(mqtt_client, {
                    "event": "error", "status": "error", "role": "receiver",
                    "error": str(exc), "t": int(time.time() * 1000),
                })
                break

            if not buffer:
                continue

            audio = np.concatenate(buffer, axis=0).astype(np.float32).reshape(-1)
            duration_s = round(len(audio) / args.sample_rate, 1)
            rms = audio_rms(audio)
            peak = audio_peak_db(audio)
            sf.write(wav_path, audio, args.sample_rate, subtype="PCM_16")
            size = os.path.getsize(wav_path)
            print(f"[rx] wrote {wav_path}  {duration_s}s  peak={peak}dB  rms={rms:.4f}")
            publish(mqtt_client, {
                "event":       "captured",
                "status":      "captured",
                "role":        "receiver",
                "device":      device_name,
                "source":      source_kind,
                "wav_path":    wav_path,
                "wav_bytes":   size,
                "duration_s":  duration_s,
                "peak_db":     peak,
                "rms":         round(rms, 4),
                "t":           int(time.time() * 1000),
            })
    finally:
        stream.stop()
        stream.close()
        publish(mqtt_client, {
            "event":  "offline",
            "status": "offline",
            "role":   "receiver",
            "t":      int(time.time() * 1000),
        })
        if mqtt_client is not None:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
        print("[rx] stopped")


def main():
    parser = argparse.ArgumentParser(description="HOLOCUBE SSTV audio receiver")
    parser.add_argument("--broker", help="MQTT broker host to publish status to (optional)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker TCP port (default 1883)")
    parser.add_argument("--device", help="Input device name (partial match) or index. Omit for the OS default input.")
    parser.add_argument("--loopback", action="store_true",
                        help="Record what's playing to the laptop speakers (Windows WASAPI loopback).")
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE,
                        help=f"Capture sample rate (default {DEFAULT_SAMPLE_RATE})")
    parser.add_argument("--chunk-seconds", type=int, default=DEFAULT_CHUNK_SECONDS,
                        help=f"Length of each rolling WAV file (default {DEFAULT_CHUNK_SECONDS}s)")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR,
                        help=f"Directory to save captured WAV files (default {DEFAULT_OUT_DIR})")
    parser.add_argument("--list-devices", action="store_true",
                        help="Print available audio devices and exit.")
    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        return

    record(args)


if __name__ == "__main__":
    main()
