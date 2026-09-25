# The BACAR Pyramid Payload

**AMSAT SA BACAR-14 "Skybridge" — 17 October 2026**
Contact: Christo Kriek, ZR6LJK — christo.kriek@live.co.za (subject "BACAR")

A natural-light Pepper's Ghost experiment for a high-altitude balloon flight.

---

## What it is trying to do

This payload uses the Earth itself as the light source for an optical illusion
called a Pepper's Ghost, so that a small camera inside a 100 mm cube records
what looks like a floating, three-dimensional image of the Earth below.

Most hologram-pyramid gadgets sit on a desk and reflect a bright video screen.
This one removes the screen entirely. Flown to 25–35 km, it points a single
opening downward at the bright, sunlit Earth. That view *is* the source. A
four-sided clear pyramid reflects it toward a camera, and the camera captures
a floating image formed from real light coming off the planet — no screen, no
power drawn for the image, just optics.

**The question behind it:** can a natural-light Pepper's Ghost capture a
recognisable Earth from the edge of space? Desk versions rely on darkness and
a bright screen. Here the conditions are inverted — the source is far away and
the surroundings are bright. Whether the effect still reads on camera is the
experiment. Success or not, the result is worth recording.

> **Not a hologram.** Real holography needs coherent laser light and
> interference patterns. A pyramid produces a reflection-based floating image —
> visually similar, physically different. "Hologram pyramid" is a popular but
> technically loose name.

---

## The optical principle

Two conditions make a Pepper's Ghost work, and both drive the whole design:

**A bright source against a dark background.** In reflection, black effectively
becomes invisible. Any background light that isn't part of the intended image
shows up as a faint grey box and ruins the illusion. This is why the interior
must be matte black and light-sealed.

**A specific viewpoint.** The floating image only exists when seen through the
reflecting face from the correct angle. The camera has to sit exactly where a
viewer's eye would — it cannot be placed anywhere and "look at the hologram",
because there is no free-floating image to photograph. It must look *at the
reflection in the pyramid face*.

---

## How light travels through the payload

| Step | What happens |
|---|---|
| **1. Entry** | Light from the sunlit Earth travels up through one round aperture in the floor — the only opening that admits image light. Sealed with a clear disc that still passes light. |
| **2. Reflection** | It strikes the inside of one clear acrylic pyramid face, which acts as a partial mirror. |
| **3. Redirection** | The angled face turns the upward light sideways, toward the camera. |
| **4. Capture** | The camera, tilted **18°**, looks at that face and records the floating image. |

### Why 18 degrees

The pyramid faces sit at **54°**, set by the shape of the pre-cut acrylic
panels. A mirror doubles any tilt, so a face 9° steeper than a plain 45° mirror
sends the reflected ray out **18° away from level**. The camera is angled 18°
to look straight back down that reflected path.

The number is forced by the pyramid's geometry, not chosen for looks.

### Why one aperture, not four

An earlier idea used four holes, one per face. It was set aside deliberately:

- **Four holes** — each face reflects a different direction, so the camera sees
  four unrelated views layered on top of each other. Busy, incoherent, and four
  openings to seal against the cold instead of one.
- **One aperture** — a single source produces one clean, coherent floating image
  of whatever is directly below, and only one opening needs sealing.

---

## Structure

A **100 × 100 × 100 mm cube** — the maximum size allowed for the flight — built
from flat panels of **3 mm black acrylic**, laser-cut and glued with acrylic
cement into a light-tight box. Black is essential, not cosmetic: it absorbs
stray light that would otherwise wash out the reflection.

### Panels

| Panel | Features |
|---|---|
| **Floor** | Round light aperture (offset, under the camera's line of sight), sealed clear window, four corner holes for the suspension line, slots locating the pyramid base |
| **Lid** | Pyramid-top support, suspension ring holes, corner string holes matching the floor so the load line runs straight through |
| **Four walls** | Solid and black. Only two carry openings — a small antenna hole, and mounting features for the camera bracket |

### Internal parts

- **The pyramid** — pre-cut four-sided clear acrylic frustum. Base ~85 mm,
  flat top ~9 mm, faces at 54°. Sits base-down on the floor, tip up.
- **Pyramid mounts** — four base clips locate the base; a top support slots
  into the lid and captures the 9 mm tip. Held at both ends.
- **Camera bracket** — two triangular brackets with an 18° top edge, plus a
  flat plate the camera screws to.
- **Electronics** — ESP32-CAM recording to its own card, nRF24 radio,
  MT3608 boost converter, 18650 lithium cell.

**Mass: ~385 g** against a 500 g limit.

---

## Designing for the environment

At 25–35 km the air is thin and temperature falls to around **−50 to −60 °C**.
The payload can't be recovered mid-flight, so it must survive unattended.

**Cold.** The electronics and battery are rated for far milder temperatures
than they'll meet. The box is insulated, a hand-warmer adds heat, and a
silica-gel sachet removes moisture that would otherwise freeze inside.

**Frost.** As the box cools, trapped moisture condenses and can freeze on the
pyramid and lens — directly in the optical path. The sealed window keeps damp
air out; anti-fog treatment helps; keeping the interior warm and dry is the
real defence.

**Landing.** The payload returns under parachute at several metres per second.
Acrylic is brittle in the cold, so glued joints and mounts must take the
impact. Drop-test before flight.

---

## ⚠ Three things that need resolving

These are conflicts between this document and what's currently built. They
are not cosmetic.

### 1. "Airtight" will destroy the box

A sealed enclosure at 30 km carries roughly **1 bar of pressure differential**.
On a 100 × 100 mm panel that's about **1000 N — 100 kgf pushing outward on
every face.** Glued 3 mm acrylic will not hold that, and if it fails it fails
explosively, taking the optics with it.

The frost argument for sealing is real, but the pressure problem is fatal.
The standard resolution is to **vent, but slowly**: a small hole with a
tortuous or filtered path, plus the silica gel already planned. Air equalises
gradually; moist air doesn't rush in. Do not fly this genuinely airtight.

### 2. The 3D-printed enclosure is now obsolete

`holocube.py`, `holocube_fitcheck.py` and the exported STL/STEP files describe
a **printed** cube with the camera on-axis looking down the pyramid's centre.
This document describes a **laser-cut acrylic** cube with the camera tilted
18° looking at a face from the side. They are different machines.

Nothing is lost by keeping the files, but don't print from them expecting the
optics in this document.

### 3. Radio: beacon or downlink?

This document calls the nRF24 "a short-range beacon for recovery". The firmware
currently streams telemetry images over it as well. The streaming version also
functions as a beacon, so there's no conflict in practice — but if the intent
really is beacon-only, the image transmission can be disabled and the cycle
gets shorter.

---

## The flight cycle (~48 s, repeats forever)

```
1. 15 s video clip        -> SD card
2. 1x high-res photo      -> SD card   (UXGA master)
3. 1x low-res photo       -> SD card + streamed over nRF24
4. 30 s pause
```

At 5 m/s ascent that's a full snapshot every **~240 m**, about 125 samples on
the way to 30 km. Set `pause_sec=42` in the config for a 60 s cycle and
exactly 300 m per sample.

| | 3-hour flight |
|---|---|
| Card usage | ~383 MB |
| Average current | ~162 mA |
| Battery used | ~7% of 12 Ah |

Video rolls 15 s out of every 48, so there's roughly a **31% chance of catching
the burst on video**.

### Packet format (32 bytes)

```
[0] type   [1] fragment   [2..31] 30 bytes payload
```

Integrity is the nRF24's **hardware CRC-16** — corrupt packets never arrive.
The end-of-image CRC tells the receiver whether the *reassembly* was complete,
which is a different question. nRF24 carries raw packets, not MQTT; MQTT lives
at mission control, on the far side of the relay.

---

## Pin map — SD and nRF24 share one SPI bus

The camera claims almost every GPIO. These six are all that remain.
**Do not use `SD_MMC`** — it wants these same pins.

| Signal | GPIO |
|---|---|
| SCK | 14 |
| MOSI | 15 |
| MISO | 2 |
| SD chip-select | 13 |
| nRF24 CSN | 12 |
| nRF24 CE | 4 |

---

## Things that will destroy hardware

- **nRF24 VCC → 3V3, never 5V.** No regulator on the module.
- **Set the MT3608 to 5.0 V with a multimeter before connecting the ESP32.**
  It does not ship at 5 V.
- **10 kΩ from IO12 to GND.** Strapping pin — high at boot means the chip
  picks the wrong flash voltage and won't start at all.
- **Capacitor stripe → GND.** Electrolytics vent if reversed.
- **Black tape over the flash LED.** IO4 doubles as that LED and would flood
  the optical chamber on every transmission.

---

## Files

| File | What it is |
|---|---|
| `holocube_selftest/` | **Upload this first.** Checks camera, PSRAM, SD, radio. |
| `holocube_esp32cam/` | Flight firmware. |
| `holocube_receiver_uno/` | Ground receiver for an Arduino Uno. |
| `holocube_rebuild.py` | Reassembles JPEGs from the receiver's serial stream. |
| `holocube.cfg` | **Copy to the SD card root.** Tune exposure and timing without reflashing. |
| `SOLDERING.md` | Bench checklist with three test points. |
| `holocube.py` | *Superseded* — FreeCAD builder for the printed enclosure. |
| `holocube_fitcheck.py` | *Superseded* — collision check for the printed enclosure. |

---

## The honest unknown

The enclosure is the easy part. The box, mounts, sealing and mass budget are
all solved on paper. The single thing that decides whether the payload succeeds
is whether a natural-light Pepper's Ghost actually produces a recognisable
floating Earth on camera — and that cannot be answered by design alone.

**The critical step before committing to the flight is a ground test.** Put the
camera in its mount, aim the sealed aperture at a bright scene with depth, and
record. If the floating image reads on the ground, it will read from altitude.
If it doesn't, that's discovered cheaply on a bench instead of expensively at
30 km.

### Test order

- [ ] **Optical bench test** — does the ghost read at all?
- [ ] **Focus the lens at infinity**, lock it with nail varnish
- [ ] **Tune `aec`** in `holocube.cfg` — exposure is locked and 300 is a guess
- [ ] **Full-duration run** — the whole flight time, armed, exactly as it flies
- [ ] **Freezer test** — one hour assembled and armed
- [ ] **Drop test** — acrylic is brittle cold

On a high-altitude flight, **cold, power and landing cause far more failures
than the optics ever will.** Test in that order.
