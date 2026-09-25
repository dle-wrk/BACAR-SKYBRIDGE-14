# AGENTS.md

## Project Context

**BACAR-14 "Skybridge" — Pyramid Payload.** A natural-light Pepper's Ghost
experiment for a high-altitude balloon flight (17 October 2026). See
`README.md` for the mission background and hardware bill.

This repo is a monorepo of everything except the mission-day operations
folder: web dashboard, ground-station tooling, firmware, and CAD sources.

## Layout

- `src/`, `public/`, `index.html`, `vite.config.js` — React web dashboard
  (Vite + Tailwind + shadcn/ui + MQTT via `mqtt.js`). Deployed on Fly.io to
  `bacar-skybridge-14.fly.dev`.
- `firmware/` — Arduino sketches:
  - `holocube_esp32cam/` — ESP32-CAM (AI-Thinker) flight firmware.
  - `holocube_receiver_uno/` — Uno + NRF24 ground receiver.
  - `holocube_selftest/` — subsystem probe.
  - `battcaptester/` — 18650 capacity tester.
- `ground-station/` — Python tools that run on the base-station laptop:
  - `holocube_rebuild.py` — reassembles JPEGs from the NRF hex stream, and
    optionally publishes each image + STATUS heartbeat to MQTT.
  - `holocube_sstv.py` — subscribes to cube image topics and encodes each
    JPEG as SSTV audio (Robot36 default, Martin M1 etc. available).
- `hardware/` — CAD and schematics:
  - `holocube.py` / `holocube_fitcheck.py` — FreeCAD build + fit-check scripts
    for the printed cube parts.
  - `HOLOCUBE MODULAR v2.0.scad` — OpenSCAD source.
  - `lasercut/` — FreeCAD sources and DXFs for every laser-cut part.
  - `battery_tester_schematic.svg`.

## Local dev

Frontend:

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build to dist/
npm run lint       # eslint
npm run typecheck  # tsc against jsconfig.json
```

Deploy:

```bash
fly deploy --remote-only
```

Ground-station tooling has its own install (`pip install pyserial paho-mqtt
pysstv Pillow`). See `ground-station/README.md`.

## Key files

- `src/App.jsx` — router / IdentifyGate / Mission Control.
- `src/lib/mqttService.js` — MQTT topic map, telemetry normaliser, and the
  simulation that runs when no broker is configured.
- `src/pages/MissionControl.jsx` and `src/pages/CubeDetail.jsx` — the two
  routed pages.

## Working notes

- **No Base44.** The project was scaffolded from a Base44 starter template
  but the SDK, auth flow, and every Base44-hosted asset have been removed
  (see commit `f81fe95`). Do not reintroduce `@base44/*` packages or hosted
  URLs. Auth state, when needed, uses the local observer flow in
  `src/lib/observer.js`.
- **MQTT broker.** The deployed web app defaults to
  `wss://broker.emqx.io:8084/mqtt` (public EMQX). Python tools talk to the
  same broker over plain TCP on port 1883. The `holocube_rebuild.py`
  publisher and the web app's subscriber share the schema
  `bacar.nrf.image.v1` — don't drift the shape of that JSON on one side
  without updating the other.
- **Simulation.** With no broker URL configured, `mqttService.js` runs a
  realistic stratospheric-balloon sim so the UI is fully demonstrable
  offline. Handy when working on the frontend without the flight hardware.
- **Run the relevant checks from `package.json` before finishing code
  changes** (`lint`, `typecheck`, `build`).
