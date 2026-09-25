/* ============================================================
   HOLOCUBE RECEIVER  —  Arduino Uno + NRF24L01+
   Ground / relay test receiver for BACAR-14 "Skybridge"

   Packet format (32 bytes):
     [0] type   [1] fragment   [2..31] 30 bytes payload
   Integrity is the NRF24's own hardware CRC-16 — anything
   corrupt never reaches us, so there's nothing to check here.

   The Uno has 2 KB of RAM and cannot buffer an image, so it
   streams good packets out as hex and the PC reassembles.
   See holocube_rebuild.py.

   WIRING  (Uno hardware SPI)
     NRF24  CE   -> D9        MOSI -> D11
     NRF24  CSN  -> D10       MISO -> D12
     NRF24  SCK  -> D13       GND  -> GND
     NRF24  VCC  -> 3.3V   <-- NOT 5V. The module will die on 5V.

   Put 10 uF across the module's VCC/GND pins, legs short.
   Skipping that is the most common cause of "it doesn't work".
   ============================================================ */

#include <SPI.h>
#include <RF24.h>

#define PIN_CE   9
#define PIN_CSN 10
RF24 radio(PIN_CE, PIN_CSN);

const uint8_t ADDR_RX[5] = {0x11, 0x22, 0x33, 0x44, 0x55};
const uint8_t NRF_CHANNEL = 100;

#define PKT_SIZE      32
#define PKT_IMG_START 0x01
#define PKT_IMG_DATA  0x02
#define PKT_IMG_END   0x03
#define PKT_VID_META  0x04
#define PKT_STATUS    0x06

uint32_t n_rx = 0;
uint32_t t_report = 0;

void setup() {
  Serial.begin(115200);
  Serial.println(F("# HOLOCUBE receiver"));

  if (!radio.begin()) {
    Serial.println(F("# NRF24 NOT FOUND - check wiring and 3.3V"));
    while (1) { delay(1000); }
  }
  radio.setPALevel(RF24_PA_MAX);
  radio.setDataRate(RF24_250KBPS);
  radio.setChannel(NRF_CHANNEL);
  radio.setAutoAck(false);
  radio.setCRCLength(RF24_CRC_16);
  radio.openReadingPipe(1, ADDR_RX);
  radio.startListening();

  Serial.println(F("# listening on channel 100 @ 250kbps"));
  t_report = millis();
}

void loop() {
  if (radio.available()) {
    uint8_t p[PKT_SIZE];
    radio.read(p, PKT_SIZE);
    n_rx++;

    if (p[0] == PKT_STATUS) {
      uint16_t up   = ((uint16_t)p[2]  << 8) | p[3];
      uint16_t cyc  = ((uint16_t)p[4]  << 8) | p[5];
      uint16_t img  = ((uint16_t)p[6]  << 8) | p[7];
      uint16_t vid  = ((uint16_t)p[8]  << 8) | p[9];
      int16_t  die  = ((int16_t) p[11] << 8) | p[12];
      Serial.print(F("# ALIVE up="));  Serial.print(up);
      Serial.print(F("s cyc="));       Serial.print(cyc);
      Serial.print(F(" hi="));         Serial.print(img);
      Serial.print(F(" vid="));        Serial.print(vid);
      Serial.print(F(" sd="));         Serial.print(p[10]);
      Serial.print(F(" die="));        Serial.print(die / 10.0, 1);
      Serial.println(F("C"));
      return;
    }

    if (p[0] == PKT_VID_META) {
      uint16_t vid = ((uint16_t)p[2] << 8) | p[3];
      uint16_t fr  = ((uint16_t)p[4] << 8) | p[5];
      Serial.print(F("# VIDEO clip ")); Serial.print(vid);
      Serial.print(F(" - "));           Serial.print(fr);
      Serial.print(F(" frames, "));     Serial.print(p[6]);
      Serial.println(F("s, on the SD card"));
      return;
    }

    // image packets go out as hex for the PC to reassemble
    Serial.print('P');
    for (uint8_t i = 0; i < PKT_SIZE; i++) {
      if (p[i] < 16) Serial.print('0');
      Serial.print(p[i], HEX);
    }
    Serial.println();
  }

  if (millis() - t_report > 10000UL) {
    t_report = millis();
    Serial.print(F("# rx packets=")); Serial.println(n_rx);
  }
}
