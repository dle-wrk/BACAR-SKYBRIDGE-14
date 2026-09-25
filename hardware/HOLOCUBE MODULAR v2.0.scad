// ============================================================
// HOLOCUBE  —  AMSAT SA BACAR-14 "Skybridge"  —  17 Oct 2026
// 98mm cube. Pepper's Ghost sky-combiner.
// THREE printed parts: PLATE / BODY / LID, 8x M3 self-tappers.
// Rides freely on the train line through 4 corner straws.
//
// FLIES WIDE END DOWN. Camera looks down through the pyramid.
// PRINT PLATE + BODY IN BLACK. PETG if you have it.
// WRAP THE LID ONLY, outside, in space blanket.
// ============================================================

PART = "ALL";   // "ALL" | "PLATE" | "BODY" | "LID" | "LAYOUT"

CELLS   = 1;      // 1 = needs MT3608 boost.  2 = series + 3 diodes.

// ---- perspex (measured) ----
W_BASE  = 85;
W_TOP   = 9;
EDGE    = 75;
PANEL_T = 3;      // <<< MEASURE YOURS

// ---- airframe ----
CUBE    = 98;
WALL    = 2;
PLATE_T = 3;
SPLIT   = 58;
LIP_H   = 6;
RIM_H   = 11;

NADIR_R = 15;     // <<< print spare plates at 12 / 15 / 20
WIN_W   = 70;
WIN_H   = 42;

// ---- corner straws ----
STRAW_C = 44.5;
TUBE_R  = 4.5;
STRAW_R = 3.0;

// ---- screws: 8x M3 self-tapping ----
SCREW_C    = 46;
LIDSCREW_Z = 61;

// ---- internal stack ----
BRKT_Z   = 63;
TROUGH_Z = 82;

// ---- derived ----
DR      = (W_BASE - W_TOP)/2;
H_PLANE = sqrt(EDGE*EDGE - DR*DR);
FRUS_H  = sqrt(H_PLANE*H_PLANE - DR*DR);
SEAT_Z  = PLATE_T;
APEX    = SEAT_Z + FRUS_H;
TILT    = 180 - atan(FRUS_H/DR);
$fn     = 40;

echo(str("face ", atan(FRUS_H/DR), " deg | apex z=", APEX,
         " | cells ", CELLS));

if (PART == "ALL")    { plate(); body(); lid(); pyramid(); }
if (PART == "PLATE")    plate();
if (PART == "BODY")     translate([0,0,-PLATE_T]) body();
if (PART == "LID")      translate([0,0,-SPLIT]) lid();
if (PART == "LAYOUT") {
    translate([-55,-55,0]) plate();
    translate([ 55,-55,0]) translate([0,0,-PLATE_T]) body();
    translate([  0, 55,0]) rotate([180,0,0]) translate([0,0,-CUBE]) lid();
}

// ============================================================
// SHARED
// ============================================================
module pyramid_solid(cl) {
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0, W_BASE/2, SEAT_Z]) rotate([TILT,0,0])
        translate([0,0,-cl])
          linear_extrude(PANEL_T + 2*cl)
            offset(delta=cl)
              polygon([[-W_BASE/2,0],[W_BASE/2,0],
                       [W_TOP/2,H_PLANE],[-W_TOP/2,H_PLANE]]);
}
module pyramid() { color([0.55,0.78,1.0,0.28]) pyramid_solid(0); }

module straw_bores(z0,h) {
    for (x=[-STRAW_C,STRAW_C]) for (y=[-STRAW_C,STRAW_C])
      translate([x,y,z0]) cylinder(h=h, r=STRAW_R);
}

// ============================================================
// PART 1 — BASE PLATE
// ============================================================
module plate() {
  color([0.30,0.30,0.33])
  difference() {
    linear_extrude(PLATE_T) square([CUBE,CUBE], center=true);

    translate([0,0,-1]) cylinder(h=PLATE_T+2, r=NADIR_R);

    // straw bores with lead-in chamfer
    for (x=[-STRAW_C,STRAW_C]) for (y=[-STRAW_C,STRAW_C])
      translate([x,y,-1]) {
          cylinder(h=PLATE_T+2, r=STRAW_R);
          cylinder(h=2.5, r1=STRAW_R+1.5, r2=STRAW_R);
      }

    // screw clearance + countersink (flush underside)
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0,SCREW_C,-1]) {
          cylinder(h=PLATE_T+2, r=1.7);
          cylinder(h=2.7, r1=3.2, r2=1.7);
      }
  }
}

// ============================================================
// PART 2 — BODY
// ============================================================
module body() {
  color([0.25,0.25,0.28])
  difference() {
    union() {
        // walls
        difference() {
            translate([0,0,PLATE_T])
              linear_extrude(SPLIT-PLATE_T) square([CUBE,CUBE], center=true);
            translate([0,0,PLATE_T-1])
              linear_extrude(SPLIT-PLATE_T+2)
                square([CUBE-2*WALL, CUBE-2*WALL], center=true);
        }

        // corner straw tubes
        for (x=[-STRAW_C,STRAW_C]) for (y=[-STRAW_C,STRAW_C])
          translate([x,y,PLATE_T]) cylinder(h=SPLIT-PLATE_T, r=TUBE_R);

        // locating rim: seats the pyramid, carries the plate screws
        translate([0,0,PLATE_T])
          linear_extrude(RIM_H)
            difference() {
                square([94,94], center=true);
                square([87,87], center=true);
            }

        // alignment lip for the lid
        translate([0,0,SPLIT-1])
          linear_extrude(LIP_H+1)
            difference() {
                square([92,92], center=true);
                square([88,88], center=true);
            }

        // bosses for the lid screws, on the inner face of the lip
        for (a=[0:90:270]) rotate([0,0,a])
          translate([0,43,LIDSCREW_Z]) cube([12,6,10], center=true);
    }

    // guarantee clearance around the perspex everywhere
    pyramid_solid(0.6);

    // light windows
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0, CUBE/2, 30]) cube([WIN_W, 12, WIN_H], center=true);

    // plate screw pilots, blind, from below
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0,SCREW_C,PLATE_T-1]) cylinder(h=9, r=1.25);

    // lid screw pilots, horizontal
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0,43,LIDSCREW_Z]) rotate([90,0,0])
        cylinder(h=8, r=1.25, center=true);

    straw_bores(PLATE_T-1, SPLIT+LIP_H);
  }
}

// ============================================================
// PART 3 — LID   (all electronics)
// ============================================================
module lid() {
  color([0.72,0.80,0.95])
  difference() {
    union() {
        difference() {
            translate([0,0,SPLIT])
              linear_extrude(CUBE-SPLIT) square([CUBE,CUBE], center=true);
            translate([0,0,SPLIT])
              linear_extrude(CUBE-SPLIT-WALL)
                square([CUBE-2*WALL, CUBE-2*WALL], center=true);
        }

        for (x=[-STRAW_C,STRAW_C]) for (y=[-STRAW_C,STRAW_C])
          translate([x,y,SPLIT]) cylinder(h=CUBE-SPLIT, r=TUBE_R);

        // pyramid clamp collar — FIT A FOAM PAD ON THE LOWER FACE
        translate([0,0,APEX+0.5])
          difference() {
              cylinder(h=BRKT_Z-APEX-0.5, r1=9, r2=12);
              translate([0,0,-1])
                cylinder(h=BRKT_Z-APEX+1.5, r1=4.3, r2=8.5);
          }

        // camera bracket
        translate([0,0,BRKT_Z]) linear_extrude(2) square([38,50], center=true);
        for (a=[0:90:270]) rotate([0,0,a])
          translate([0,32,BRKT_Z+1]) cube([30,30,2], center=true);

        // 18650 trough(s) with cable-tie slots
        for (i=[0:CELLS-1]) {
          yy = (CELLS==1) ? 28 : (i==0 ? -34 : 34);
          translate([0,yy,TROUGH_Z]) {
            difference() {
                cube([68,22,20], center=true);
                rotate([0,90,0]) cylinder(h=70, r=9.4, center=true);
                translate([0,0,8]) cube([70,18,10], center=true);
            }
            for (dx=[-22,22]) translate([dx,0,0])
              difference() {
                  cube([4,26,20], center=true);
                  cube([6,22,22], center=true);
              }
          }
        }

        // NRF24 slot
        for (dx=[-2,2])
          translate([32+dx,-16,74]) cube([1.6,30,16], center=true);

        // wiring loom anchors
        for (a=[0:90:270]) rotate([0,0,a])
          translate([44,20,SPLIT+2]) cube([4,3,10], center=true);
    }

    straw_bores(SPLIT-1, CUBE-SPLIT+2);

    // straw lead-in at the top exit
    for (x=[-STRAW_C,STRAW_C]) for (y=[-STRAW_C,STRAW_C])
      translate([x,y,CUBE-2.5]) cylinder(h=3, r1=STRAW_R, r2=STRAW_R+1.5);

    // lens bore through bracket
    translate([0,0,BRKT_Z-1]) cylinder(h=5, r=9);

    // lid screw clearance, horizontal (pan-head, sits proud)
    for (a=[0:90:270]) rotate([0,0,a])
      translate([0,CUBE/2+1,LIDSCREW_Z]) rotate([90,0,0])
        cylinder(h=9, r=1.7);

    // keyring / safety tether holes
    for (x=[-34,34]) for (y=[-34,34])
      translate([x,y,CUBE-12]) cylinder(h=14, r=2.5);

    // pressure vents
    for (a=[0:90:270]) rotate([0,0,a])
      for (x=[-16,16])
        translate([x, CUBE/2, 93]) rotate([90,0,0])
          cylinder(h=12, r=2, center=true);

    // arming switch port
    translate([0,-CUBE/2,68]) cube([16,10,10], center=true);
  }
}