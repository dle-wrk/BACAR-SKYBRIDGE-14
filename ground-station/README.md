# Skybridge ground-station tools

Python scripts that run on the base-station laptop (not in the deployed web app).
They bridge the NRF24 radio link and the MQTT broker the web dashboard subscribes to.

## Scripts

**`holocube_rebuild.py`** — reads the hex packet stream from the Uno receiver on
serial, reassembles low-res JPEGs, writes them to `rx_images/`, and (optionally)
publishes each image and STATUS heartbeat to MQTT so the Skybridge web app and
downstream tools see them.

**`holocube_sstv.py`** — subscribes to Skybridge cube image topics, encodes each
incoming JPEG as SSTV audio (Robot36 by default, plus Robot72, Martin M1, Scottie
S1, Pasokon P3, PD120), writes a `.wav` per image, and optionally plays it through
the default audio device — for VB-CABLE → radio TX on Windows.

## Install

```bash
pip install pyserial paho-mqtt pysstv Pillow
```

## Typical live loop

```bash
# terminal 1 — rebuild images from NRF and publish to the public broker
python ground-station/holocube_rebuild.py COM8 --mqtt broker.emqx.io

# terminal 2 — re-transmit each incoming image as SSTV audio
python ground-station/holocube_sstv.py --broker broker.emqx.io --play
```

Chain:

```
ESP32-CAM → NRF24 → UNO → serial → holocube_rebuild.py → MQTT → holocube_sstv.py → radio
                                       ↓
                                   web app dashboard
```

See each script's `--help` for full options.
