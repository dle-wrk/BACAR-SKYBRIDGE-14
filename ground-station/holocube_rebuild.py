#!/usr/bin/env python3
"""
HOLOCUBE — ground-station image rebuilder
BACAR-14 "Skybridge"

Reads the hex packet stream from the Uno receiver and reassembles
the low-res telemetry JPEGs. Optionally re-publishes each reassembled
image and STATUS heartbeat to MQTT so the Skybridge web app and the
SSTV bridge can pick them up.

  live:               python holocube_rebuild.py COM8
  offline:            python holocube_rebuild.py --file capture.txt
  live + MQTT public: python holocube_rebuild.py COM8 --mqtt broker.emqx.io
  live + MQTT local:  python holocube_rebuild.py COM8 --mqtt localhost

Packet format (32 bytes):
  [0] type   [1] fragment   [2..31] 30 bytes payload
Integrity is the NRF24's hardware CRC-16, so anything that arrives
is already known-good. The end-of-image CRC tells us whether the
REASSEMBLY was complete, which is a different question.

Missing fragments are zero-filled rather than dropped — a JPEG with
a few corrupt rows still shows you the ghost, and on a one-way link
you will lose packets.

Live mode needs pyserial:      pip install pyserial
MQTT publish needs paho-mqtt:  pip install paho-mqtt
"""

import argparse
import base64
import json
import os
import time

OUT_DIR = "rx_images"

PKT_IMG_START = 0x01
PKT_IMG_DATA  = 0x02
PKT_IMG_END   = 0x03
PKT_VID_META  = 0x04
PKT_STATUS    = 0x06
CHUNK         = 30

# Defaults match src/lib/mqttService.js in the Skybridge web app so the
# dashboard picks these up without any extra wiring.
DEFAULT_CUBE_ID       = "BACAR-14C"           # HoloCube — nrf_image_only mode
DEFAULT_IMAGE_TOPIC   = "bacar/skybridge14/cubeC/image"
DEFAULT_TELEM_TOPIC   = "holocube/telemetry"
IMAGE_SCHEMA          = "bacar.nrf.image.v1"  # matches _parseNrfImagePayload


def crc16(data):
    crc = 0x0000
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


class MqttPublisher:
    """Thin wrapper around paho-mqtt so the rest of the script doesn't
    grow a hard dependency. Silently no-ops on connection errors — a dead
    broker must never stop the rebuilder from writing files."""

    def __init__(self, broker, port, image_topic, telemetry_topic, cube_id, publish_partial):
        import paho.mqtt.client as mqtt
        self.image_topic     = image_topic
        self.telemetry_topic = telemetry_topic
        self.cube_id         = cube_id
        self.publish_partial = publish_partial
        self.client = mqtt.Client(client_id="holocube-rebuild-%d" % int(time.time()))
        try:
            self.client.connect(broker, port, keepalive=60)
            self.client.loop_start()
            print("   MQTT connected to %s:%d (images -> %s, telemetry -> %s)"
                  % (broker, port, image_topic, telemetry_topic))
        except Exception as exc:
            print("   MQTT connect failed (%s) - continuing without publish" % exc)
            self.client = None

    def _publish(self, topic, payload, qos):
        if self.client is None:
            return
        try:
            self.client.publish(topic, json.dumps(payload), qos=qos)
        except Exception as exc:
            print("   MQTT publish failed on %s: %s" % (topic, exc))

    def publish_image(self, jpg_bytes, img_id, tag, size, received, total):
        if tag == "CRCFAIL":
            return  # never publish a JPEG we know is corrupt
        if tag == "PARTIAL" and not self.publish_partial:
            return
        payload = {
            "schema":            IMAGE_SCHEMA,
            "cube_id":           self.cube_id,
            "t":                 int(time.time() * 1000),
            "img_id":            img_id,
            "quality":           tag,
            "size":              size,
            "packets_received":  received,
            "packets_total":     total,
            "image": {
                "data":      base64.b64encode(jpg_bytes).decode("ascii"),
                "mime_type": "image/jpeg",
            },
        }
        self._publish(self.image_topic, payload, qos=1)

    def publish_status(self, up_s, cycle, hi_res, videos, sd_ok, die_c):
        payload = {
            "cube_id":          self.cube_id,
            "id":               self.cube_id,
            "t":                int(time.time() * 1000),
            "uptime_s":         up_s,
            "cycle":            cycle,
            "images_captured":  hi_res,
            "videos_captured":  videos,
            "sd_ok":            bool(sd_ok),
            "temperature_c":    die_c,
            "status":           "live",
            "source":           "nrf-bridge",
            "mode":             "nrf_image_only",
        }
        self._publish(self.telemetry_topic, payload, qos=0)

    def close(self):
        if self.client is None:
            return
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass


class Rebuilder:
    def __init__(self, publisher=None):
        self.reset()
        self.done = 0
        self.publisher = publisher
        os.makedirs(OUT_DIR, exist_ok=True)

    def reset(self):
        self.frags = {}
        self.size = 0
        self.total = 0
        self.img_id = None
        self.expect_crc = None

    def packet(self, p):
        t = p[0]

        if t == PKT_STATUS:
            up  = (p[2] << 8) | p[3]
            cyc = (p[4] << 8) | p[5]
            img = (p[6] << 8) | p[7]
            vid = (p[8] << 8) | p[9]
            sd  = p[10]
            die = int.from_bytes(bytes(p[11:13]), "big", signed=True) / 10.0
            if self.publisher:
                self.publisher.publish_status(up, cyc, img, vid, sd, die)
            return ("ALIVE  up=%ds  cycle=%d  hi-res=%d  videos=%d  sd=%s  die=%.1fC"
                    % (up, cyc, img, vid, "ok" if sd else "FAIL", die))

        if t == PKT_VID_META:
            vid = (p[2] << 8) | p[3]
            fr  = (p[4] << 8) | p[5]
            return "VIDEO clip %d - %d frames, %ds, on the SD card" % (vid, fr, p[6])

        if t == PKT_IMG_START:
            if self.frags:
                self.flush()
            self.reset()
            self.img_id = (p[2] << 8) | p[3]
            self.size   = (p[4] << 8) | p[5]
            self.total  = p[8]
            aec         = (p[9] << 8) | p[10]
            return ("START image %d  (%d bytes, %d packets, aec=%d)"
                    % (self.img_id, self.size, self.total, aec))

        if t == PKT_IMG_DATA:
            if self.img_id is None:
                return None                     # joined mid-image
            self.frags[p[1]] = bytes(p[2:2 + CHUNK])
            return None

        if t == PKT_IMG_END:
            self.expect_crc = (p[4] << 8) | p[5]
            return self.flush()

        return None

    def flush(self):
        if not self.frags or self.size == 0:
            return None

        n = self.total if self.total else (self.size + CHUNK - 1) // CHUNK
        buf = bytearray()
        missing = 0
        for f in range(1, n + 1):
            chunk = self.frags.get(f)
            if chunk is None:
                missing += 1
                chunk = b"\x00" * CHUNK
            buf.extend(chunk)
        buf = bytes(buf[:self.size])

        ok = (self.expect_crc is not None and crc16(buf) == self.expect_crc)
        tag = "OK" if ok else ("PARTIAL" if missing else "CRCFAIL")

        name = os.path.join(OUT_DIR, "rx_%05d_%s.jpg" % (self.img_id or 0, tag))
        with open(name, "wb") as fh:
            fh.write(buf)

        if self.publisher:
            self.publisher.publish_image(
                buf, self.img_id or 0, tag, self.size, n - missing, n,
            )

        self.done += 1
        pct = 100.0 * (n - missing) / max(n, 1)
        msg = ("SAVED %s   %d/%d packets (%.1f%%)  %s"
               % (os.path.basename(name), n - missing, n, pct, tag))
        self.reset()
        return msg


def feed(rb, line):
    line = line.strip()
    if not line:
        return
    if line.startswith("#"):
        print("   " + line[1:].strip())
        return
    if not line.startswith("P"):
        return
    hexs = line[1:]
    if len(hexs) < 64:
        return
    try:
        p = bytes.fromhex(hexs[:64])
    except ValueError:
        return
    msg = rb.packet(p)
    if msg:
        print("   " + msg)


def build_publisher(args):
    """Return an MqttPublisher or None. --mqtt is the switch; broker/port/topics
    have sensible defaults matching the Skybridge web app."""
    if not args.mqtt:
        return None
    try:
        return MqttPublisher(
            broker=args.mqtt,
            port=args.mqtt_port,
            image_topic=args.mqtt_image_topic,
            telemetry_topic=args.mqtt_telem_topic,
            cube_id=args.cube_id,
            publish_partial=args.publish_partial,
        )
    except ImportError:
        print("paho-mqtt not installed:  pip install paho-mqtt")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", help="serial port, e.g. COM8")
    ap.add_argument("--file", help="replay a saved log instead")
    ap.add_argument("--baud", type=int, default=115200)

    ap.add_argument("--mqtt", metavar="HOST",
                    help="publish images and status to this MQTT broker "
                         "(e.g. broker.emqx.io or localhost). Off by default.")
    ap.add_argument("--mqtt-port", type=int, default=1883,
                    help="MQTT broker TCP port (default 1883)")
    ap.add_argument("--mqtt-image-topic", default=DEFAULT_IMAGE_TOPIC,
                    help="topic for reassembled images (default %s)" % DEFAULT_IMAGE_TOPIC)
    ap.add_argument("--mqtt-telem-topic", default=DEFAULT_TELEM_TOPIC,
                    help="topic for STATUS heartbeats (default %s)" % DEFAULT_TELEM_TOPIC)
    ap.add_argument("--cube-id", default=DEFAULT_CUBE_ID,
                    help="cube id sent in MQTT payloads (default %s)" % DEFAULT_CUBE_ID)
    ap.add_argument("--publish-partial", action="store_true",
                    help="also publish PARTIAL images (default: only OK)")
    a = ap.parse_args()

    publisher = build_publisher(a)
    rb = Rebuilder(publisher=publisher)
    print("HOLOCUBE rebuilder - writing to ./%s/\n" % OUT_DIR)

    try:
        if a.file:
            with open(a.file, "r", errors="ignore") as fh:
                for line in fh:
                    feed(rb, line)
            print("\nDone. %d images written." % rb.done)
            return

        if not a.port:
            ap.error("give a serial port, or use --file")

        try:
            import serial
        except ImportError:
            print("pyserial not installed:  pip install pyserial")
            return

        with serial.Serial(a.port, a.baud, timeout=1) as s, \
             open("capture.txt", "a") as log:
            print("listening on %s ... ctrl-C to stop\n" % a.port)
            try:
                while True:
                    line = s.readline().decode(errors="ignore")
                    if line:
                        log.write(line)
                        log.flush()
                        feed(rb, line)
            except KeyboardInterrupt:
                print("\nstopped. %d images written. raw log in capture.txt" % rb.done)
    finally:
        if publisher:
            publisher.close()


if __name__ == "__main__":
    main()
