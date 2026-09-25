/* ============================================================
   HOLOCUBE SELF-TEST
   Upload this FIRST. It checks each subsystem in turn and says
   which one is broken, instead of leaving you guessing.

   Expected on a healthy board with no NRF24 fitted yet:

     [1] SERIAL ......... ok
     [2] PSRAM .......... ok  (4096 KB)
     [3] CAMERA ......... ok
     [4] CAPTURE ........ ok  (4132 bytes)
     [5] SD CARD ........ ok  (7580 MB)
     [6] SD WRITE ....... ok
     [7] NRF24 .......... not fitted yet - expected

   Serial Monitor at 115200.
   ============================================================ */

#include <Arduino.h>
#include <esp_camera.h>
#include <SPI.h>
#include <SD.h>
#include <RF24.h>

#define PIN_SCK      14
#define PIN_MOSI     15
#define PIN_MISO      2
#define PIN_SD_CS    13
#define PIN_NRF_CSN  12
#define PIN_NRF_CE    4

SPIClass hspi(HSPI);
RF24 radio(PIN_NRF_CE, PIN_NRF_CSN);

int passed = 0, failed = 0;

void result(const char *name, bool ok, const char *note = "") {
  Serial.printf("  %-18s %s  %s\n", name, ok ? "ok        " : "FAILED    ", note);
  if (ok) passed++; else failed++;
}

bool camera_start() {
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
  c.frame_size   = FRAMESIZE_QQVGA;
  c.jpeg_quality = 10;
  c.fb_count     = 2;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;
  return esp_camera_init(&c) == ESP_OK;
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("\n\n============================================");
  Serial.println("  HOLOCUBE SELF-TEST   BACAR-14 Skybridge");
  Serial.println("============================================\n");

  char note[48];

  result("[1] SERIAL", true);

  bool ps = psramFound();
  snprintf(note, sizeof(note), ps ? "%u KB" : "enable PSRAM in Tools menu",
           (unsigned)(ESP.getPsramSize() / 1024));
  result("[2] PSRAM", ps, note);

  bool cam = camera_start();
  result("[3] CAMERA", cam, cam ? "" : "check the ribbon cable seating");

  size_t jpg_len = 0;
  if (cam) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) { jpg_len = fb->len; esp_camera_fb_return(fb); }
    snprintf(note, sizeof(note), "%u bytes", (unsigned)jpg_len);
    result("[4] CAPTURE", jpg_len > 0, note);
  } else {
    result("[4] CAPTURE", false, "skipped, camera down");
  }

  hspi.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_SD_CS);

  bool sd = SD.begin(PIN_SD_CS, hspi, 20000000);
  if (sd) snprintf(note, sizeof(note), "%llu MB", SD.cardSize() / (1024ULL * 1024ULL));
  else    snprintf(note, sizeof(note), "no card, or format it FAT32");
  result("[5] SD CARD", sd, note);

  if (sd) {
    File f = SD.open("/selftest.txt", FILE_WRITE);
    bool w = false;
    if (f) { w = (f.print("holocube selftest ok\n") > 0); f.close(); }
    result("[6] SD WRITE", w, w ? "wrote /selftest.txt" : "card may be write-protected");
  } else {
    result("[6] SD WRITE", false, "skipped, no card");
  }

  bool nrf = radio.begin(&hspi);
  if (nrf) {
    radio.setPALevel(RF24_PA_MAX);
    radio.setDataRate(RF24_250KBPS);
    radio.setChannel(100);
    radio.setAutoAck(false);
    radio.stopListening();
  }
  result("[7] NRF24", nrf, nrf ? "responding" : "not fitted yet - expected");

  Serial.printf("\n  %d passed, %d failed\n", passed, failed);
  if (failed == 0 || (failed == 1 && !nrf))
    Serial.println("\n  GOOD. Ready for the real firmware.\n");
  else
    Serial.println("\n  Fix the FAILED lines above before going further.\n");

  Serial.println("Capturing every 5s. Frame size tells you if the lens is capped.\n");
}

void loop() {
  static uint32_t n = 0;
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) {
    Serial.printf("  frame %-4lu  %6u bytes   die %.1f C\n",
                  ++n, (unsigned)fb->len, temperatureRead());
    esp_camera_fb_return(fb);
  } else {
    Serial.println("  capture failed");
  }
  delay(5000);
}
