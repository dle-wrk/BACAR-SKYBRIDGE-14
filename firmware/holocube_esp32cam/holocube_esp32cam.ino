/* ============================================================
   HOLOCUBE  —  AMSAT SA BACAR-14 "Skybridge"  —  17 Oct 2026
   ESP32-CAM (AI-Thinker) payload firmware

   Pepper's Ghost sky-combiner. Camera looks DOWN through the
   pyramid; the four perspex panels reflect the limb into frame.

   THE CYCLE  (~48 s, repeats forever)
     1. 15 s video clip            -> SD card
     2. 1x high-res photo          -> SD card  (the master)
     3. 1x low-res photo           -> SD card + streamed over NRF24
     4. 30 s pause

   WHY IT'S BUILT THIS WAY
     - SD card is the PRIMARY record. Radio is the demo. If the
       link fails you still recover every frame on landing.
     - Nothing halts. A dead subsystem is logged and skipped.
     - Files are closed after every write. Power loss costs one
       frame, not the card.
     - Exposure is LOCKED. Auto-exposure meters on the bright
       nadir disc and crushes the ghost arcs to black.
     - Sensor resolution changes twice per cycle, with discard
       frames after each switch. The first frame after a
       framesize change is unreliable.

   TUNING WITHOUT REFLASHING
     Put a file called holocube.cfg in the root of the SD card:
         aec=300
         gain=0
         hi_quality=10
         lo_quality=18
         video_sec=15
         pause_sec=30
     Missing file or bad lines -> compiled defaults are used.

   LIBRARIES   RF24 by TMRh20  +  esp32 by Espressif
   BOARD       AI Thinker ESP32-CAM
   PARTITION   Huge APP (3MB No OTA)
   ============================================================ */

#include <Arduino.h>
#include <esp_camera.h>
#include <SPI.h>
#include <SD.h>
#include <RF24.h>

// ---- SD and NRF24 SHARE ONE SPI BUS ----
#define PIN_SCK      14
#define PIN_MOSI     15
#define PIN_MISO      2
#define PIN_SD_CS    13
#define PIN_NRF_CSN  12   // needs a 10k pulldown to GND (strapping pin)
#define PIN_NRF_CE    4   // shared with the flash LED - tape over it

SPIClass hspi(HSPI);
RF24 radio(PIN_NRF_CE, PIN_NRF_CSN);

const uint8_t ADDR_TX[5] = {0x11, 0x22, 0x33, 0x44, 0x55};
const uint8_t NRF_CHANNEL = 100;

// ---- defaults (overridable from holocube.cfg) ----
uint16_t cfg_aec        = 300;   // 0..1200  exposure. THE number to tune.
uint8_t  cfg_gain       = 0;     // 0..30    keep low, gain is noise
uint8_t  cfg_hi_quality = 10;    // 10..63   lower = better
uint8_t  cfg_lo_quality = 18;    // telemetry shot, keep it small
uint16_t cfg_video_sec  = 15;
uint16_t cfg_pause_sec  = 30;

#define HI_RES  FRAMESIZE_UXGA   // 1600x1200 master
#define LO_RES  FRAMESIZE_QQVGA  // 160x120   telemetry + video

// ---- packet format: 32 bytes, hardware CRC-16 does integrity ----
//   [0] type   [1] fragment   [2..31] 30 bytes of payload
#define PKT_IMG_START 0x01
#define PKT_IMG_DATA  0x02
#define PKT_IMG_END   0x03
#define PKT_VID_META  0x04
#define PKT_STATUS    0x06
#define PKT_SIZE      32
#define CHUNK         30
#define MAX_FRAGS     255
#define MAX_TX_BYTES  (MAX_FRAGS * CHUNK)   // 7650

uint16_t image_id = 0, video_id = 0;
uint32_t n_cycles = 0, n_images = 0, n_videos = 0;
uint32_t n_sd_fail = 0, n_cam_fail = 0, n_tx_skip = 0;
bool sd_ok = false, radio_ok = false;
uint32_t t0 = 0;

// ============================================================
// CRC-16-CCITT — only used end-to-end on a whole image, so the
// receiver can tell a perfect reassembly from a lossy one.
// ============================================================
uint16_t crc16(const uint8_t *d, uint32_t n) {
  uint16_t crc = 0x0000;
  for (uint32_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (uint8_t j = 0; j < 8; j++)
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

void send_packet(uint8_t type, uint8_t frag, const uint8_t *payload, uint8_t len) {
  if (!radio_ok) return;
  uint8_t p[PKT_SIZE];
  memset(p, 0, PKT_SIZE);
  p[0] = type;
  p[1] = frag;
  if (payload && len) memcpy(&p[2], payload, min((int)len, CHUNK));
  radio.write(p, PKT_SIZE);
}

// ============================================================
// CONFIG FILE — read once at boot, ignore anything malformed
// ============================================================
void load_config() {
  if (!sd_ok) return;
  File f = SD.open("/holocube.cfg", FILE_READ);
  if (!f) { Serial.println("[CFG] no holocube.cfg, using defaults"); return; }

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0 || line.startsWith("#")) continue;
    int eq = line.indexOf('=');
    if (eq < 1) continue;
    String k = line.substring(0, eq);   k.trim();
    String v = line.substring(eq + 1);  v.trim();
    long n = v.toInt();

    if      (k == "aec")        cfg_aec        = constrain(n, 0, 1200);
    else if (k == "gain")       cfg_gain       = constrain(n, 0, 30);
    else if (k == "hi_quality") cfg_hi_quality = constrain(n, 10, 63);
    else if (k == "lo_quality") cfg_lo_quality = constrain(n, 10, 63);
    else if (k == "video_sec")  cfg_video_sec  = constrain(n, 1, 120);
    else if (k == "pause_sec")  cfg_pause_sec  = constrain(n, 0, 300);
  }
  f.close();
  Serial.printf("[CFG] aec=%u gain=%u hiQ=%u loQ=%u vid=%us pause=%us\n",
                cfg_aec, cfg_gain, cfg_hi_quality, cfg_lo_quality,
                cfg_video_sec, cfg_pause_sec);
}

// ============================================================
// CAMERA
// ============================================================
void lock_exposure() {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) return;
  s->set_gain_ctrl(s, 0);       // auto gain OFF
  s->set_exposure_ctrl(s, 0);   // auto exposure OFF
  s->set_aec2(s, 0);
  s->set_agc_gain(s, cfg_gain);
  s->set_aec_value(s, cfg_aec);
  s->set_brightness(s, 0);
  s->set_contrast(s, 1);        // slight lift helps the ghost read
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_vflip(s, 0);
  s->set_hmirror(s, 0);
}

// Switch resolution and throw away the frames that follow.
// The sensor needs a moment; the first frames after a change
// come back with the wrong size or a bad exposure.
void set_res(framesize_t fs, uint8_t quality) {
  sensor_t *s = esp_camera_sensor_get();
  if (!s) return;
  s->set_framesize(s, fs);
  s->set_quality(s, quality);
  lock_exposure();
  delay(200);
  for (int i = 0; i < 2; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
  }
}

bool camera_init() {
  camera_config_t c;
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = 5;  c.pin_d1 = 18; c.pin_d2 = 19; c.pin_d3 = 21;
  c.pin_d4 = 36; c.pin_d5 = 39; c.pin_d6 = 34; c.pin_d7 = 35;
  c.pin_xclk = 0; c.pin_pclk = 22; c.pin_vsync = 25; c.pin_href = 23;
  c.pin_sccb_sda = 26; c.pin_sccb_scl = 27;
  c.pin_pwdn = 32; c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size   = HI_RES;
  c.jpeg_quality = cfg_hi_quality;
  c.fb_count     = 2;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;

  if (esp_camera_init(&c) != ESP_OK) return false;
  lock_exposure();
  return true;
}

// ============================================================
// SD
// ============================================================
bool sd_write(const char *path, const uint8_t *data, size_t len) {
  if (!sd_ok) return false;
  File f = SD.open(path, FILE_WRITE);
  if (!f) { n_sd_fail++; return false; }
  size_t w = f.write(data, len);
  f.close();
  if (w != len) { n_sd_fail++; return false; }
  return true;
}

// ============================================================
// STEP 1 — video clip, low res, to the card
// ============================================================
void step_video() {
  if (!sd_ok) { Serial.println("[VID] skipped, no card"); return; }
  video_id++;

  char path[32];
  snprintf(path, sizeof(path), "/vid%04u.mjpeg", video_id);
  File f = SD.open(path, FILE_WRITE);
  if (!f) { n_sd_fail++; return; }

  uint32_t start = millis();
  uint32_t stop  = (uint32_t)cfg_video_sec * 1000UL;
  uint16_t frames = 0;

  while (millis() - start < stop) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) { n_cam_fail++; break; }
    // length-prefixed frames so a reader can walk the file
    uint32_t n = fb->len;
    uint8_t hdr[4] = {(uint8_t)(n>>24),(uint8_t)(n>>16),(uint8_t)(n>>8),(uint8_t)n};
    f.write(hdr, 4);
    f.write(fb->buf, fb->len);
    esp_camera_fb_return(fb);
    frames++;
    delay(35);          // ~25 fps, leaves the card time to breathe
    yield();
  }
  f.close();

  uint8_t m[CHUNK] = {0};
  m[0] = (uint8_t)(video_id >> 8); m[1] = (uint8_t)video_id;
  m[2] = (uint8_t)(frames >> 8);   m[3] = (uint8_t)frames;
  m[4] = (uint8_t)cfg_video_sec;
  send_packet(PKT_VID_META, 0, m, CHUNK);

  n_videos++;
  Serial.printf("[VID] %s  %u frames in %us\n", path, frames, cfg_video_sec);
}

// ============================================================
// STEP 2 — high-res master photo, card only
// ============================================================
void step_master_photo() {
  set_res(HI_RES, cfg_hi_quality);

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { n_cam_fail++; Serial.println("[HI ] capture failed"); return; }

  image_id++;
  char path[32];
  snprintf(path, sizeof(path), "/hi%05u.jpg", image_id);
  bool saved = sd_write(path, fb->buf, fb->len);

  Serial.printf("[HI ] %s  %u bytes  sd=%d\n", path, (unsigned)fb->len, (int)saved);
  esp_camera_fb_return(fb);
  n_images++;
}

// ============================================================
// STEP 3 — low-res telemetry photo, card + radio
// ============================================================
void transmit_image(const uint8_t *jpg, uint32_t len, uint16_t id) {
  if (!radio_ok) return;

  uint32_t send_len = len;
  if (send_len > MAX_TX_BYTES) {      // truncated JPEGs still render
    send_len = MAX_TX_BYTES;          // the top of the frame
    n_tx_skip++;
  }
  uint8_t total = (uint8_t)((send_len + CHUNK - 1) / CHUNK);

  uint8_t hdr[CHUNK] = {0};
  hdr[0] = (uint8_t)(id >> 8);        hdr[1] = (uint8_t)id;
  hdr[2] = (uint8_t)(send_len >> 8);  hdr[3] = (uint8_t)send_len;
  hdr[4] = 160; hdr[5] = 120;
  hdr[6] = total;
  hdr[7] = (uint8_t)(cfg_aec >> 8);   hdr[8] = (uint8_t)cfg_aec;
  send_packet(PKT_IMG_START, 0, hdr, CHUNK);
  delay(5);

  for (uint32_t i = 0, f = 1; i < send_len; i += CHUNK, f++) {
    uint8_t n = (uint8_t)min((uint32_t)CHUNK, send_len - i);
    send_packet(PKT_IMG_DATA, (uint8_t)f, &jpg[i], n);
    delayMicroseconds(900);
    if ((f & 0x1F) == 0) yield();
  }

  uint16_t whole = crc16(jpg, send_len);
  uint8_t fin[CHUNK] = {0};
  fin[0] = (uint8_t)(id >> 8);    fin[1] = (uint8_t)id;
  fin[2] = (uint8_t)(whole >> 8); fin[3] = (uint8_t)whole;
  fin[4] = total;
  send_packet(PKT_IMG_END, total, fin, CHUNK);

  Serial.printf("[TX ] image %u  %lu bytes in %u packets\n",
                id, (unsigned long)send_len, total);
}

void step_telemetry_photo() {
  set_res(LO_RES, cfg_lo_quality);

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { n_cam_fail++; Serial.println("[LO ] capture failed"); return; }

  char path[32];
  snprintf(path, sizeof(path), "/lo%05u.jpg", image_id);
  sd_write(path, fb->buf, fb->len);

  transmit_image(fb->buf, fb->len, image_id);
  esp_camera_fb_return(fb);
}

// ============================================================
// STATUS — goes out with every cycle, and onto the card
// ============================================================
void send_status() {
  uint32_t up = (millis() - t0) / 1000UL;

  // Die temperature. The original ESP32's internal sensor is unreliable
  // in absolute terms - it reads the chip, not the air, and some silicon
  // returns a fixed value. Warm the board by hand on the bench: if the
  // number moves, the TREND is usable. If it's stuck, ignore this field.
  int16_t die10 = (int16_t)(temperatureRead() * 10.0f);

  uint8_t s[CHUNK] = {0};
  s[0]  = (uint8_t)(up >> 8);        s[1]  = (uint8_t)up;
  s[2]  = (uint8_t)(n_cycles >> 8);  s[3]  = (uint8_t)n_cycles;
  s[4]  = (uint8_t)(n_images >> 8);  s[5]  = (uint8_t)n_images;
  s[6]  = (uint8_t)(n_videos >> 8);  s[7]  = (uint8_t)n_videos;
  s[8]  = sd_ok ? 1 : 0;
  s[9]  = (uint8_t)(die10 >> 8);     s[10] = (uint8_t)(die10 & 0xFF);
  s[11] = (uint8_t)n_cam_fail;
  s[12] = (uint8_t)n_sd_fail;
  send_packet(PKT_STATUS, 0, s, CHUNK);

  Serial.printf("[STAT] up=%lus cyc=%lu hi=%lu vid=%lu sd=%d die=%.1fC camfail=%lu\n",
                up, n_cycles, n_images, n_videos, (int)sd_ok,
                die10 / 10.0f, n_cam_fail);

  if (sd_ok) {
    File f = SD.open("/telemetry.csv", FILE_APPEND);
    if (f) {
      f.printf("%lu,%lu,%lu,%lu,%d,%.1f,%lu,%lu\n",
               up, n_cycles, n_images, n_videos, (int)sd_ok,
               die10 / 10.0f, n_cam_fail, n_sd_fail);
      f.close();
    }
  }
}

// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n\n=== HOLOCUBE / BACAR-14 Skybridge ===");

  hspi.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_SD_CS);

  sd_ok = SD.begin(PIN_SD_CS, hspi, 20000000);
  Serial.printf("[SD ] %s\n", sd_ok ? "ok" : "FAILED (continuing)");

  load_config();

  if (!camera_init()) Serial.println("[CAM] FATAL: init failed");
  else                Serial.println("[CAM] ok, exposure LOCKED");

  radio_ok = radio.begin(&hspi);
  if (radio_ok) {
    radio.setPALevel(RF24_PA_MAX);
    radio.setDataRate(RF24_250KBPS);
    radio.setChannel(NRF_CHANNEL);
    radio.setAutoAck(false);          // one-way link
    radio.setCRCLength(RF24_CRC_16);  // hardware integrity check
    radio.openWritingPipe(ADDR_TX);
    radio.stopListening();
  }
  Serial.printf("[NRF] %s\n", radio_ok ? "ok" : "FAILED (continuing)");

  if (sd_ok) {
    File f = SD.open("/telemetry.csv", FILE_APPEND);
    if (f) { f.println("# up_s,cycle,hi_photos,videos,sd_ok,die_C,cam_fail,sd_fail"); f.close(); }
  }

  t0 = millis();
  Serial.println("=== ARMED ===\n");
}

void loop() {
  uint32_t cycle_start = millis();
  n_cycles++;
  Serial.printf("\n--- cycle %lu ---\n", n_cycles);

  step_video();             // 1. 15 s clip -> card
  step_master_photo();      // 2. high-res  -> card
  step_telemetry_photo();   // 3. low-res   -> card + radio
  send_status();

  // sensor is already at LO_RES, so the next cycle's video
  // starts without another reconfiguration
  uint32_t elapsed = millis() - cycle_start;
  Serial.printf("--- cycle took %lus, pausing %us ---\n",
                elapsed / 1000UL, cfg_pause_sec);

  // 4. pause. delay(), not sleep: the regulator's waste heat is
  // what keeps the bay above freezing at altitude, and an idle
  // chip makes less of it.
  uint32_t pause_ms = (uint32_t)cfg_pause_sec * 1000UL;
  uint32_t t = millis();
  while (millis() - t < pause_ms) { delay(100); yield(); }
}
