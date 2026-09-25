# Skybridge firmware

Arduino sketches for the flight and ground hardware. Each sketch lives in its
own folder because Arduino IDE requires the `.ino` filename to match the parent
folder name.

## Sketches

**`holocube_esp32cam/`** — flight firmware for the ESP32-CAM (AI-Thinker) payload.
Runs the 48-second cycle: 15 s video → SD, 1 hi-res photo → SD, 1 lo-res photo →
SD + NRF24, 30 s pause. Board: **AI Thinker ESP32-CAM**. Partition: **Huge APP
(3 MB No OTA / 1 MB SPIFFS)**. Libraries: `RF24` (TMRh20), `esp32` core.

**`holocube_receiver_uno/`** — ground-station NRF24 receiver on Arduino Uno.
Prints each good packet as hex on serial for [`ground-station/holocube_rebuild.py`](../ground-station/holocube_rebuild.py)
to reassemble. Board: **Arduino Uno**. Libraries: `RF24` (TMRh20).

**`holocube_selftest/`** — subsystem probe. Upload **before** the main sketch on
either board when something isn't working — it isolates SD, camera, NRF24, and
supply issues so you know which one is broken instead of guessing.

## Flashing the ESP32-CAM

If you don't have an FTDI or the ESP32-CAM programmer board, the Uno can act as
a USB-to-serial adapter. Wire:

- **UNO RESET → GND** (parks the ATmega so its USB-serial chip talks straight
  through to the ESP)
- **UNO 5V → ESP 5V** (only if the payload's boost converter is disconnected)
- **UNO GND → ESP GND**
- **UNO D0 → ESP U0R** via a 220 Ω/330 Ω divider (or just a 1 kΩ series resistor
  as a rough current limit — the ESP's ESD clamp diodes handle the rest)
- **UNO D1 → ESP U0T** direct
- **ESP IO0 → GND** (enters bootloader mode)

Then in Arduino IDE pick `AI Thinker ESP32-CAM`, the Uno's COM port, and press
the ESP's RESET button the moment esptool prints `Connecting……`.

See `SOLDERING.md` at the project root for hardware assembly.
