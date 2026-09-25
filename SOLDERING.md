# HOLOCUBE — Soldering checklist

Work through this in order. There are three test points; **do not skip them.**
The whole point of the order is that if something is wrong you have five wires
to check, not fifteen.

---

## Before you heat the iron

- [ ] **Set the MT3608 to 5.0 V.** Cell → boost IN+/IN−, multimeter on OUT+/OUT−.
      Turn the trimpot until it reads **5.00 V**. It is a multi-turn pot, so expect
      to keep going a while before the voltage moves. It does **not** ship at 5 V,
      and connecting it blind can put 15–20 V into the ESP32 and kill it instantly.
- [ ] Black tape over the flash LED next to the camera lens.
- [ ] Confirm the switch is **latching**, not momentary. Press and release: it must
      stay down. If it springs back, it won't work as a power switch.

---

## STEP 1 — Power chain (5 wires)

| # | From | To | Colour | Length |
|---|---|---|---|---|
| 1 | Holder **red +** | Switch, pin A | red | 100 mm |
| 2 | Switch, pin B | Boost **IN+** | red | 100 mm |
| 3 | Holder **black −** | Boost **IN−** | black | 80 mm |
| 4 | Boost **OUT+** | ESP32 **5V** | red | 60 mm |
| 5 | Boost **OUT−** | ESP32 **GND** | black | 60 mm |

On a 4-pin switch the pins are two internally-joined pairs. Find them with a
continuity tester and use **one pin from each pair**. Wire across a pair and
you've made a permanent short.

### ✅ TEST POINT 1
Switch on. Multimeter on the ESP32's **5V and GND pins**. Must read **5.0 V**.
Switch off — must read 0 V. Do not continue until both are true.

---

## STEP 2 — Capacitors on the ESP32

- [ ] 2–3 × 10 µF in parallel across ESP32 **5V and GND**, short legs, at the board.
- [ ] **Striped leg goes to GND.** Backwards, electrolytics vent.

---

## STEP 3 — Programming pigtail (4 wires, NOT soldered to the Uno)

80 mm each, ending in a female header you can tuck inside the lid.

| Wire | ESP32 pin | Plugs to |
|---|---|---|
| 1 | **U0T** | Uno D1 |
| 2 | **U0R** | Uno D0 |
| 3 | **GND** | Uno GND |
| 4 | **GPIO0** | bare tinned end — touch to GND to arm the bootloader |

**No 5 V wire to the Uno. Ever.** The battery powers the ESP32 now; the Uno
supplies serial only. Two supplies fighting is how boards die.

### ✅ TEST POINT 2 — the important one
Plug in the Uno. Battery **on**. Upload `holocube_selftest`.

Ground GPIO0 → press RST → click Upload → release GPIO0 when it finishes.

You should get the numbered pass/fail list. `[7] NRF24 not fitted yet` is
expected. **Get a successful upload here before soldering anything else.**

Powering from the battery instead of the Uno should also cure the
`serial noise` / `no more data` errors — the MT3608 is a far stiffer supply
than the Uno's 5 V pin.

---

## STEP 4 — Radio (7 wires + 1 resistor + caps)

Only once STEP 3 uploads cleanly.

| # | From | To | Length |
|---|---|---|---|
| 6 | ESP32 **3V3** | NRF24 **VCC** | 60 mm |
| 7 | ESP32 **GND** | NRF24 **GND** | 60 mm |
| 8 | ESP32 **IO14** | NRF24 **SCK** | 60 mm |
| 9 | ESP32 **IO15** | NRF24 **MOSI** | 60 mm |
| 10 | ESP32 **IO2** | NRF24 **MISO** | 60 mm |
| 11 | ESP32 **IO12** | NRF24 **CSN** | 60 mm |
| 12 | ESP32 **IO4** | NRF24 **CE** | 60 mm |

- [ ] **10 kΩ from IO12 to GND.** Strapping pin — if it's high at boot the chip
      picks the wrong flash voltage and won't start at all. Skip this and you
      get a board that appears dead.
- [ ] 2–3 × 10 µF across NRF24 **VCC and GND**, soldered onto the module pins
      themselves, legs as short as possible.
- [ ] NRF24 **IRQ** stays unconnected.

**NRF24 VCC goes to 3V3, never 5V.** The module has no regulator. 5 V kills it
instantly, and this is the most common way people destroy them.

### ✅ TEST POINT 3
Re-upload `holocube_selftest`. Now `[7] NRF24` should read **ok**.

---

## STEP 5 — Tidy

- [ ] Cable-tie the loom to the four anchor posts at the lid base.
- [ ] Cable-tie the holder to the shelf (2 ties through the slots).
- [ ] A third tie **around the cell and holder together**, so the cell can't
      lift off its spring contacts under vibration. This is the top-ranked
      failure mode for the whole payload.
- [ ] Foam-tape the MT3608 to the underside of the shelf.
- [ ] Cable-tie the programming pigtail so it can't rattle, header reachable.

---

## The four that destroy hardware

1. NRF24 VCC → **3V3**, never 5 V.
2. Boost set to **5.0 V** before it touches the ESP32.
3. Capacitor **stripe → GND**.
4. **10 kΩ IO12 → GND**, or it won't boot.

---

## Wire count

12 permanent + 4 pigtail + 1 resistor + 4–6 capacitors.
Roughly 900 mm of wire total.
