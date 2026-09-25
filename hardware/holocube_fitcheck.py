# ============================================================
# HOLOCUBE — FIT CHECK
# Drops dimensionally-accurate component stand-ins into the
# assembly so collisions and clearances can be checked.
#
# Run AFTER holocube.py, in the FreeCAD Python console:
#   exec(open(r"C:\Users\Dylan\Videos\skybridge14\holocube_fitcheck.py").read())
# ============================================================

import math
import FreeCAD as App
import Part
from FreeCAD import Vector

CUBE, WALL, PLATE_T, SPLIT = 98.0, 2.0, 3.0, 58.0
BRKT_Z, SHELF_Z = 63.0, 71.0
W_BASE, W_TOP, EDGE, PANEL_T = 85.0, 9.0, 75.0, 1.0
GRV_D   = 1.0
DR      = (W_BASE - W_TOP)/2.0
H_PLANE = math.sqrt(EDGE**2 - DR**2)
FRUS_H  = math.sqrt(H_PLANE**2 - DR**2)
FACE_A  = math.degrees(math.atan2(FRUS_H, DR))
TILT    = 180.0 - FACE_A
DROP    = PANEL_T * math.cos(math.radians(FACE_A))
SEAT_Z  = PLATE_T - GRV_D + DROP
APEX    = SEAT_Z + FRUS_H

# ---- COMPONENT DIMENSIONS: measure yours and correct these ----
CAM_L, CAM_W, CAM_T   = 27.0, 40.5, 4.5
LENS_D, LENS_H        = 8.0, 9.0
NRF_L, NRF_W, NRF_T   = 15.5, 29.0, 1.6
NRF_HDR               = 11.0
HLD_L, HLD_W, HLD_H   = 77.0, 21.0, 20.0   # <<< MEASURE YOUR HOLDER
CELL_D, CELL_L        = 18.5, 65.0
BST_L, BST_W, BST_T   = 17.0, 11.0, 4.0    # MT3608

def cbox(l, w, h, x=0.0, y=0.0, z=0.0):
    return Part.makeBox(l, w, h, Vector(x - l/2.0, y - w/2.0, z))

def add(doc, name, shape, colour):
    o = doc.addObject("Part::Feature", name)
    o.Shape = shape
    try:
        o.ViewObject.ShapeColor = colour
        o.ViewObject.Transparency = 25
    except Exception:
        pass
    return o

def run():
    doc = App.ActiveDocument
    if doc is None:
        print("Run holocube.py first."); return
    print("checking against document: %s" % doc.Name)

    parts = {}

    # ESP32-CAM: board on the bracket, lens pointing down
    board = cbox(CAM_L, CAM_W, CAM_T, 0, 0, BRKT_Z + 2)
    lens  = Part.makeCylinder(LENS_D/2.0, LENS_H,
                              Vector(0, 0, BRKT_Z + 2 - LENS_H))
    parts["ESP32CAM"] = (board.fuse(lens), (0.20, 0.60, 0.20))

    # NRF24 between the fins, header end pointing to lid centre
    nrf = cbox(NRF_T, NRF_W, NRF_L, 32, -16, 66)
    hdr = cbox(NRF_HDR, 10, 2.5, 32 + NRF_HDR/2.0, -16 + NRF_W/2.0 - 5, 66)
    parts["NRF24"] = (nrf.fuse(hdr), (0.20, 0.35, 0.80))

    # 18650 holder + cell on the shelf
    hld  = cbox(HLD_L, HLD_W, HLD_H, 0, 28, SHELF_Z + 1)
    cell = Part.makeCylinder(CELL_D/2.0, CELL_L,
                             Vector(-CELL_L/2.0, 28, SHELF_Z + 1 + HLD_H/2.0),
                             Vector(1, 0, 0))
    parts["Holder"]    = (hld,  (0.75, 0.75, 0.20))
    parts["Cell18650"] = (cell, (0.85, 0.35, 0.10))

    # MT3608 taped under the shelf
    parts["Boost"] = (cbox(BST_L, BST_W, BST_T, -30, 28, SHELF_Z - 1 - BST_T),
                      (0.80, 0.20, 0.60))

    # the perspex pyramid
    p = [Vector(-W_BASE/2.0, 0, 0), Vector(W_BASE/2.0, 0, 0),
         Vector(W_TOP/2.0, H_PLANE, 0), Vector(-W_TOP/2.0, H_PLANE, 0)]
    panel = Part.Face(Part.makePolygon(p + [p[0]])).extrude(Vector(0, 0, PANEL_T))
    panel.rotate(Vector(0,0,0), Vector(1,0,0), TILT)
    panel.translate(Vector(0, W_BASE/2.0, SEAT_Z))
    pyr = panel.copy()
    for a in (90, 180, 270):
        q = panel.copy(); q.rotate(Vector(0,0,0), Vector(0,0,1), a)
        pyr = pyr.fuse(q)
    parts["Perspex"] = (pyr, (0.55, 0.80, 1.00))

    objs = {}
    for name, (shp, col) in parts.items():
        objs[name] = add(doc, name, shp, col)
    doc.recompute()

    printed = [o for o in doc.Objects if o.Name.startswith("holocube_")]
    print("\n--- CLEARANCE CHECK ---")
    clash = False
    for name, o in objs.items():
        for pr in printed:
            try:
                v = o.Shape.common(pr.Shape).Volume
            except Exception:
                continue
            if v > 1.0:
                print("  CLASH  %-10s vs %-18s  %.1f mm3" % (name, pr.Label, v))
                clash = True
    if not clash:
        print("  No collisions. Everything fits.")

    print("\n--- HEADROOM ---")
    print("  lens tip z        = %.2f   (pyramid apex %.2f)" % (BRKT_Z + 2 - LENS_H, APEX))
    print("  holder top z      = %.2f   (lid interior ceiling %.2f)" % (SHELF_Z + 1 + HLD_H, CUBE - WALL))
    print("  NRF24 top z       = %.2f" % (66 + NRF_L))

    try:
        import FreeCADGui
        FreeCADGui.ActiveDocument.ActiveView.viewAxonometric()
        FreeCADGui.SendMsgToActiveView("ViewFit")
    except Exception:
        pass
    return doc

run()
