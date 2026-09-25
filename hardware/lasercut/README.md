# Lasercut acrylic parts

FreeCAD sources for every laser-cut piece of the payload, plus the flat DXF
exports the laser cutter actually consumes.

## What's here

- `*.FCStd` — FreeCAD source per part (the authoritative model)
- `BACAR_lasercut.FCStd` — combined assembly
- `BACAR_lasercut.FCMacro` — Python macro that regenerates all outputs
- `BACAR_lasercut.pdf` — drawings / cut sheet for reference
- `dxf/*.dxf` — flat DXFs, one per part — this is what you send to the laser

## What's NOT here (regenerate from FreeCAD when needed)

DWG, STEP, STL, and the `BACAR_DXF_LASER_CUT.zip` bundle are derived outputs
of the `.FCStd` sources — kept out of the repo to reduce bloat. Regenerate any
you need from the FreeCAD file or the macro.

## FreeCAD backups

`.FCBak` files are FreeCAD's own timestamped auto-backups. They're gitignored
at the repo root (`*.FCBak`). Don't commit them.

## Parts overview

| File | Purpose |
| --- | --- |
| `LID.FCStd` | Top plate — pyramid seats on this |
| `FLOOR.FCStd` | Bottom plate — battery, boost converter, electronics |
| `WALL_L.FCStd`, `WALL_R.FCStd` | Side walls |
| `WALL_CAM.FCStd`, `WALL_NRF.FCStd` | Walls with camera / NRF antenna cutouts |
| `CAM_PLATE.FCStd` | ESP32-CAM mounting plate |
| `CAM_TRI_1.FCStd`, `CAM_TRI_2.FCStd` | Camera-plate triangles |
| `PYR_BASE_CLIP_1..4.FCStd` | Four clips holding the perspex pyramid base |
| `PYRAMID_TOP_SUPPORT.FCStd` | Tip support for the pyramid |
