# ============================================================
# HOLOCUBE  —  AMSAT SA BACAR-14 "Skybridge"  —  17 Oct 2026
# Builds all three printed parts as true solids in FreeCAD,
# then exports STL (print-oriented) and STEP.
#
# Run from the FreeCAD Python console:
#   exec(open(r"C:\Users\Dylan\Videos\skybridge14\holocube.py").read())
# ============================================================

import math, os
import FreeCAD as App
import Part
from FreeCAD import Vector

OUT = r"C:\Users\Dylan\Videos\skybridge14"

# ---------------- perspex (measured) ----------------
W_BASE, W_TOP, EDGE = 85.0, 9.0, 75.0
PANEL_T = 1.0          # measured perspex thickness
CL      = 0.6          # clearance around the perspex
GRV_D   = 1.0          # pyramid seat groove depth in the plate

# ---------------- airframe ----------------
CUBE, WALL      = 98.0, 2.0
PLATE_T         = 3.0
SPLIT           = 58.0
LIP_H, RIM_H    = 6.0, 11.0
NADIR_R         = 15.0
WIN_W, WIN_H    = 70.0, 42.0
STRAW_C, TUBE_R, STRAW_R = 44.5, 4.4, 3.0
SCREW_C, LIDSCREW_Z      = 46.0, 61.0
BRKT_Z, SHELF_Z          = 63.0, 71.0

DR      = (W_BASE - W_TOP) / 2.0
H_PLANE = math.sqrt(EDGE**2 - DR**2)
FRUS_H  = math.sqrt(H_PLANE**2 - DR**2)
SEAT_Z  = PLATE_T
APEX    = SEAT_Z + FRUS_H
TILT    = 180.0 - math.degrees(math.atan2(FRUS_H, DR))

print("face angle %.2f deg | apex z=%.3f | frustum %.3f" %
      (math.degrees(math.atan2(FRUS_H, DR)), APEX, FRUS_H))

# ---------------- helpers ----------------
def cbox(l, w, h, x=0.0, y=0.0, z=0.0):
    return Part.makeBox(l, w, h, Vector(x - l/2.0, y - w/2.0, z))

def ccube(l, w, h, x=0.0, y=0.0, z=0.0):
    return Part.makeBox(l, w, h, Vector(x - l/2.0, y - w/2.0, z - h/2.0))

def cyl(r, h, x=0.0, y=0.0, z=0.0):
    return Part.makeCylinder(r, h, Vector(x, y, z))

def cone(r1, r2, h, x=0.0, y=0.0, z=0.0):
    return Part.makeCone(r1, r2, h, Vector(x, y, z))

def rotz(shape, deg):
    s = shape.copy()
    s.rotate(Vector(0, 0, 0), Vector(0, 0, 1), deg)
    return s

def four(shape):
    out = shape.copy()
    for a in (90, 180, 270):
        out = out.fuse(rotz(shape, a))
    return out

def corners():
    return [(sx * STRAW_C, sy * STRAW_C) for sx in (-1, 1) for sy in (-1, 1)]

# ---------------- the perspex pyramid ----------------
def panel(cl):
    p = [Vector(-(W_BASE/2 + cl), -cl, 0),
         Vector( (W_BASE/2 + cl), -cl, 0),
         Vector( (W_TOP/2  + cl),  H_PLANE + cl, 0),
         Vector(-(W_TOP/2  + cl),  H_PLANE + cl, 0)]
    face  = Part.Face(Part.makePolygon(p + [p[0]]))
    solid = face.extrude(Vector(0, 0, PANEL_T + 2*cl))
    solid.translate(Vector(0, 0, -cl))
    solid.rotate(Vector(0, 0, 0), Vector(1, 0, 0), TILT)
    solid.translate(Vector(0, W_BASE/2.0, SEAT_Z))
    return solid

def pyramid(cl):
    return four(panel(cl))

# ============================================================
# PART 1 — PLATE
# ============================================================
def make_plate():
    s = cbox(CUBE, CUBE, PLATE_T)
    s = s.cut(cyl(NADIR_R, PLATE_T + 2, 0, 0, -1))
    # pyramid seat groove — the panel's low corner drops in here
    s = s.cut(cbox(86, 86, GRV_D + 1, 0, 0, PLATE_T - GRV_D)
                .cut(cbox(82, 82, GRV_D + 3, 0, 0, PLATE_T - GRV_D - 1)))
    for (x, y) in corners():
        s = s.cut(cyl(STRAW_R, PLATE_T + 2, x, y, -1))
        s = s.cut(cone(STRAW_R + 1.5, STRAW_R, 2.5, x, y, -1))
    for a in range(4):
        t = math.radians(a * 90)
        x, y = -SCREW_C*math.sin(t), SCREW_C*math.cos(t)
        s = s.cut(cyl(1.7, PLATE_T + 2, x, y, -1))
        s = s.cut(cone(3.2, 1.7, 2.7, x, y, -1))
    return s

# ============================================================
# PART 2 — BODY
# ============================================================
def make_body():
    s = cbox(CUBE, CUBE, SPLIT - PLATE_T, 0, 0, PLATE_T)
    s = s.cut(cbox(CUBE - 2*WALL, CUBE - 2*WALL, SPLIT - PLATE_T + 2,
                   0, 0, PLATE_T - 1))

    for (x, y) in corners():
        s = s.fuse(cyl(TUBE_R, SPLIT - PLATE_T, x, y, PLATE_T))

    rim = cbox(96, 96, RIM_H, 0, 0, PLATE_T) \
            .cut(cbox(86, 86, RIM_H + 2, 0, 0, PLATE_T - 1))
    s = s.fuse(rim)

    lip = cbox(92, 92, LIP_H + 1, 0, 0, SPLIT - 1) \
            .cut(cbox(88, 88, LIP_H + 3, 0, 0, SPLIT - 2))
    s = s.fuse(lip)

    s = s.fuse(four(ccube(12, 8, 9, 0, 43, LIDSCREW_Z)))

    s = s.cut(pyramid(CL))
    s = s.cut(four(ccube(WIN_W, 12, WIN_H, 0, CUBE/2.0, 30)))

    for a in range(4):
        t = math.radians(a * 90)
        x, y = -SCREW_C*math.sin(t), SCREW_C*math.cos(t)
        s = s.cut(cyl(1.25, 9, x, y, PLATE_T - 1))

    pil = cyl(1.25, 8, 0, 0, 0)
    pil.rotate(Vector(0, 0, 0), Vector(1, 0, 0), -90)
    pil.translate(Vector(0, 39, LIDSCREW_Z))
    s = s.cut(four(pil))

    for (x, y) in corners():
        s = s.cut(cyl(STRAW_R, SPLIT + LIP_H, x, y, PLATE_T - 1))
    return s

# ============================================================
# PART 3 — LID
# ============================================================
def make_lid():
    s = cbox(CUBE, CUBE, CUBE - SPLIT, 0, 0, SPLIT)
    s = s.cut(cbox(CUBE - 2*WALL, CUBE - 2*WALL, CUBE - SPLIT - WALL,
                   0, 0, SPLIT))

    for (x, y) in corners():
        s = s.fuse(cyl(TUBE_R, CUBE - SPLIT, x, y, SPLIT))

    ch = BRKT_Z - APEX - 0.5
    collar = cone(9, 12, ch, 0, 0, APEX + 0.5) \
               .cut(cone(4.3, 8.5, ch + 1.5, 0, 0, APEX - 0.5))
    s = s.fuse(collar)

    s = s.fuse(cbox(38, 50, 2, 0, 0, BRKT_Z))
    s = s.fuse(four(ccube(30, 32, 2, 0, 32, BRKT_Z + 1)))
    s = s.fuse(ccube(96, 28, 2, 0, 28, SHELF_Z))

    # NRF24 fins — short, so the header end hangs clear
    for dx in (-2, 2):
        s = s.fuse(ccube(1.6, 16, 20, 32 + dx, -22, 74))

    s = s.fuse(four(ccube(4, 3, 10, 44, 20, SPLIT + 2)))

    # ---- cuts ----
    for (x, y) in corners():
        s = s.cut(cyl(STRAW_R, CUBE - SPLIT + 2, x, y, SPLIT - 1))
        s = s.cut(cone(STRAW_R, STRAW_R + 1.5, 3, x, y, CUBE - 2.5))

    for dy in (-15, 15):
        for dx in (-16, 16):
            s = s.cut(ccube(3, 5, 6, dx, dy, BRKT_Z))

    th = cyl(1.5, 12, 0, 0, 0)
    th.rotate(Vector(0, 0, 0), Vector(0, 1, 0), 90)
    th.translate(Vector(26, -22, 82))
    s = s.cut(th)

    for dx in (-25, 25):
        for dy in (15.5, 40.5):
            s = s.cut(ccube(5, 3, 6, dx, dy, SHELF_Z))

    s = s.cut(cyl(9, 5, 0, 0, BRKT_Z - 1))

    scr = cyl(1.7, 9, 0, 0, 0)
    scr.rotate(Vector(0, 0, 0), Vector(1, 0, 0), -90)
    scr.translate(Vector(0, 40, LIDSCREW_Z))
    s = s.cut(four(scr))

    for x in (-34, 34):
        for y in (-34, 34):
            s = s.cut(cyl(2.5, 14, x, y, CUBE - 12))

    v = cyl(2, 12, 0, 0, 0)
    v.rotate(Vector(0, 0, 0), Vector(1, 0, 0), -90)
    for dx in (-16, 16):
        vv = v.copy(); vv.translate(Vector(dx, CUBE/2.0 - 6, 93))
        s = s.cut(four(vv))

    s = s.cut(ccube(16, 10, 10, 0, -CUBE/2.0, 68))
    return s

# ============================================================
# BUILD, SHOW, EXPORT
# ============================================================
def build():
    parts = {"plate": make_plate(), "body": make_body(), "lid": make_lid()}

    doc = App.newDocument("HOLOCUBE")
    objs = {}
    for name, shp in parts.items():
        o = doc.addObject("Part::Feature", "holocube_" + name)
        o.Shape = shp
        objs[name] = o
    doc.recompute()

    exp = {}
    exp["plate"] = parts["plate"].copy()

    b = parts["body"].copy()
    b.translate(Vector(0, 0, -PLATE_T))
    exp["body"] = b

    l = parts["lid"].copy()
    l.rotate(Vector(0, 0, 0), Vector(1, 0, 0), 180)
    l.translate(Vector(0, 0, CUBE))
    exp["lid"] = l

    for name, shp in exp.items():
        bb = shp.BoundBox
        print("%-6s  %.1f x %.1f x %.1f mm   volume %.1f cm3"
              % (name, bb.XLength, bb.YLength, bb.ZLength, shp.Volume / 1000.0))
        shp.exportStl(os.path.join(OUT, "holocube_%s.stl" % name))

    Part.export([objs["plate"], objs["body"], objs["lid"]],
                os.path.join(OUT, "holocube_assembly.step"))

    try:
        import FreeCADGui
        FreeCADGui.ActiveDocument.ActiveView.viewAxonometric()
        FreeCADGui.SendMsgToActiveView("ViewFit")
    except Exception:
        pass

    print("DONE. STL + STEP written to:")
    print(OUT)
    return doc

build()
