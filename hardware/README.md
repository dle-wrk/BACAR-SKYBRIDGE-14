# Skybridge hardware / CAD

FreeCAD scripts that build the printed cube parts as solids and validate
component fit. Run from inside the FreeCAD Python console.

## Scripts

**`holocube.py`** — builds all three printed parts as true solids, exports
STL (print-oriented) and STEP into the parent directory.

```
exec(open(r"C:\path\to\Skybridge14\hardware\holocube.py").read())
```

**`holocube_fitcheck.py`** — drops dimensionally-accurate stand-ins (ESP32-CAM,
NRF24, 18650, boost converter, perspex panels) into the assembly so collisions
and clearances can be sanity-checked. Run **after** `holocube.py`.

```
exec(open(r"C:\path\to\Skybridge14\hardware\holocube_fitcheck.py").read())
```

## Note on output paths

`holocube.py` currently writes STL/STEP to a hardcoded absolute path
(`OUT = r"C:\Users\Dylan\Videos\skybridge14"`). If you clone this on another
machine, change that constant to somewhere writable before running.
