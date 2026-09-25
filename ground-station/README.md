# Skybridge ground-station tools

Python scripts that run on the base-station laptop (not in the deployed web app).
They bridge the NRF24 radio link, the MQTT broker the web dashboard subscribes
to, and (via a separate audio-capture path) external SSTV transmissions heard
on the radio.

## Scripts

**`holocube_rebuild.py`** — reads the hex packet stream from the Uno receiver on
serial, reassembles low-res JPEGs, writes them to `rx_images/`, and (optionally)
publishes each image and STATUS heartbeat to MQTT so the Skybridge web app and
downstream tools see them.

**`holocube_sstv_rx.py`** — SSTV audio receiver. Captures audio from a chosen
laptop input device (mic, line-in, or a WASAPI loopback of what's playing to
the speakers) and saves rolling 60-second WAV files to `sstv_rx/`. Publishes
`sstv/status` so the web dashboard's SSTV tab reflects what's coming in. Feed
the saved WAVs into MMSSTV / QSSTV / an online decoder to recover the images.

**Skybridge cubes do NOT transmit SSTV.** This tool exists so the base station
can monitor *external* SSTV sources — pico balloons, ISS SSTV events, HAMs on
the pass.

**`holocube_sstv.py`** — SSTV **encoder** (legacy). Takes a JPEG and produces
SSTV audio for transmission. Kept for testing but not part of the mission-day
flow. Subscribes to cube image topics if you want to *send* an image out on the
air; skip it if you only want to receive.

## Install

```bash
pip install pyserial paho-mqtt pysstv Pillow sounddevice soundfile numpy
```

`sounddevice` ships PortAudio bundled on Windows — no separate install.

## Typical live loop (receive-only)

```bash
# terminal 1 — reassemble incoming NRF images from the Uno
python ground-station/holocube_rebuild.py COM8 --mqtt broker.emqx.io

# terminal 2 — capture external SSTV audio from the laptop speakers
python ground-station/holocube_sstv_rx.py --broker broker.emqx.io --loopback
```

Chain:

```
ESP32-CAM → NRF24 → UNO → serial → holocube_rebuild.py → MQTT → web dashboard
                                                                    ▲
                            radio → laptop audio → holocube_sstv_rx.py
                                                    (rolling WAV, MQTT status)
```

## Audio device selection

`holocube_sstv_rx.py` supports three ways to pick the input:

1. **Default input** (no flag). Whatever Windows uses as the default recording
   device — usually the built-in mic.
2. **--loopback** (Windows). Record what's playing to the laptop speakers via
   WASAPI loopback. Handy for capturing audio from an SDR web receiver or an
   audio-over-USB radio interface without any cable routing.
3. **--device "<name>"**. Partial-match a device by name. Run `--list-devices`
   first to see everything sounddevice can enumerate. Useful for things like
   VB-CABLE Output or a specific USB audio interface.

See each script's `--help` for full options.
