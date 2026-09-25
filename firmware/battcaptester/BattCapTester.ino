#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>

// --- Pin Definitions ---
#define TFT_CS     10
#define TFT_DC      9
#define TFT_RST    -1  // RES tied to 3V3; library sends a software reset (all 4 shifter channels in use)
#define GATE_PIN    5  // Controls MOSFET via 220 ohm resistor (10k pull-down on gate)
#define START_PIN   2  // Push buttons wired pin -> button -> GND (internal pull-ups)
#define STOP_PIN    3
#define RESET_PIN   4
#define BUZZER_PIN  6  // Optional 5 V buzzer: D6 -> buzzer + , buzzer - -> GND

// --- Buzzer (optional) ---
#define BUZZER_ENABLED  1     // 0 = silent / no buzzer fitted
#define BUZZER_PASSIVE  0     // 0 = active buzzer (beeps on DC), 1 = passive buzzer (needs a tone)
#define BUZZER_FREQ_HZ  2700  // Passive buzzer only

// --- Failsafe Thresholds ---
#define CUTOFF_VOLTAGE_V   3.00   // Discontinue discharge at 3.0V (must hold for CUTOFF_CONFIRM_MS)
#define HARD_CUTOFF_V      2.80   // Immediate cutoff, no confirmation delay
#define START_VOLTAGE_MIN  3.20   // Minimum voltage to start a new test

// --- Timing ---
#define SAMPLE_INTERVAL_MS    250  // INA219 read + capacity integration
#define DISPLAY_INTERVAL_MS  1000  // Screen + serial update
#define CUTOFF_CONFIRM_MS    2000  // Voltage must stay <= CUTOFF_VOLTAGE_V this long before the test ends
#define DEBOUNCE_MS            30
#define TFT_SPI_HZ        4000000  // BSS138 level shifters can't reliably pass the default 8 MHz

// --- Objects ---
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);
Adafruit_INA219 ina219;

// --- Buttons ---
struct Button {
  uint8_t pin;
  bool stable;              // debounced level (HIGH = released)
  bool lastRead;
  unsigned long changedAt;
};
Button btnStart = { START_PIN, HIGH, HIGH, 0 };
Button btnStop  = { STOP_PIN,  HIGH, HIGH, 0 };
Button btnReset = { RESET_PIN, HIGH, HIGH, 0 };

// --- State Variables ---
// No automatic start: a test only begins on START, so charging in-circuit is safe.
enum TestState { STATE_IDLE, STATE_TESTING, STATE_PAUSED, STATE_COMPLETE };
TestState currentState = STATE_IDLE;
bool lowCellWarning = false;   // START pressed with a cell below START_VOLTAGE_MIN

float voltage_V      = 0.0;
float current_mA     = 0.0;
float prevCurrent_mA = -1.0;   // -1 = no previous sample since the load switched on
float capacity_mAh   = 0.0;

unsigned long lastSampleMillis  = 0;
unsigned long lastDisplayMillis = 0;
unsigned long conditionSince    = 0;
unsigned long testMillis        = 0;   // discharge time only; paused time is not counted
unsigned long elapsedTimeSec    = 0;

// Non-blocking beep pattern
uint8_t       beepsLeft     = 0;
unsigned int  beepOnMs      = 0;
unsigned int  beepOffMs     = 0;
bool          beepIsOn      = false;
unsigned long beepChangedAt = 0;

void setup() {
  // Ensure load is OFF immediately at startup
  pinMode(GATE_PIN, OUTPUT);
  digitalWrite(GATE_PIN, LOW);

  pinMode(START_PIN, INPUT_PULLUP);
  pinMode(STOP_PIN,  INPUT_PULLUP);
  pinMode(RESET_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerWrite(false);

  Serial.begin(115200);

  // Initialize 0.96" 80x160 IPS ST7735 Display first, so errors can be shown on it
  tft.initR(INITR_MINI160x80);
  tft.setSPISpeed(TFT_SPI_HZ);
  tft.setRotation(1); // Landscape mode
  tft.fillScreen(ST7735_BLACK);

  // Initialize INA219
  if (!ina219.begin()) {
    Serial.println(F("Failed to find INA219 chip!"));
    tft.setTextColor(ST7735_RED);
    tft.setCursor(4, 36);
    tft.print(F("INA219 NOT FOUND"));
    while (1) { delay(10); }
  }
  // 1 A range: finer current resolution (40 uA/bit), overflows at ~1.3 A
  ina219.setCalibration_32V_1A();

  readSensors();
  drawStaticUI();
  updateDynamicUI();
  Serial.println(F("time_s, voltage_V, current_mA, capacity_mAh, state"));
}

void loop() {
  unsigned long now = millis();

  handleButtons(now);
  updateBuzzer(now);

  if (now - lastSampleMillis >= SAMPLE_INTERVAL_MS) {
    unsigned long deltaTime = now - lastSampleMillis;
    lastSampleMillis = now;
    readSensors();
    runStateMachine(now, deltaTime);
  }

  if (now - lastDisplayMillis >= DISPLAY_INTERVAL_MS) {
    lastDisplayMillis = now;
    // Output live metrics to Serial Monitor / CSV
    printSerialData();
    // Refresh Display Values
    updateDynamicUI();
  }
}

void readSensors() {
  // INA219 is high-side: bus (Vin- to GND) + shunt drop = cell voltage
  float busVoltage   = ina219.getBusVoltage_V();
  float shuntVoltage = ina219.getShuntVoltage_mV() / 1000.0;
  voltage_V  = busVoltage + shuntVoltage;
  current_mA = ina219.getCurrent_mA();

  // Prevent negative current readings from noise when OFF
  if (current_mA < 0) current_mA = 0;
}

// --- Buttons ---
// Returns true once per press (debounced falling edge).
bool buttonPressed(Button &b, unsigned long now) {
  bool reading = digitalRead(b.pin);
  if (reading != b.lastRead) {
    b.lastRead  = reading;
    b.changedAt = now;
  }
  if (now - b.changedAt >= DEBOUNCE_MS && reading != b.stable) {
    b.stable = reading;
    return b.stable == LOW;
  }
  return false;
}

void handleButtons(unsigned long now) {
  // Read all three every pass so their debounce state stays current
  bool startPressed = buttonPressed(btnStart, now);
  bool stopPressed  = buttonPressed(btnStop,  now);
  bool resetPressed = buttonPressed(btnReset, now);

  if (resetPressed) {
    // Abort from any state: load off, clear results
    loadOff();
    clearTest();
    setState(STATE_IDLE);
    beep(1, 250, 0);
    Serial.println(F("EVENT, RESET"));
    return;
  }

  if (stopPressed && currentState == STATE_TESTING) {
    // Pause: load off, keep capacity and time so START can resume
    loadOff();
    setState(STATE_PAUSED);
    beep(2, 80, 100);
    Serial.println(F("EVENT, PAUSED"));
    return;
  }

  if (startPressed) {
    switch (currentState) {
      case STATE_IDLE:
      case STATE_COMPLETE:
        if (voltage_V >= START_VOLTAGE_MIN) {
          clearTest();
          loadOn();
          setState(STATE_TESTING);
          beep(1, 80, 0);
          Serial.println(F("EVENT, START"));
        } else {
          lowCellWarning = true;
          updateDynamicUI();
          beep(3, 60, 60);
          Serial.println(F("EVENT, START REFUSED - CELL BELOW START VOLTAGE"));
        }
        break;

      case STATE_PAUSED:
        if (voltage_V > CUTOFF_VOLTAGE_V) {
          loadOn();
          setState(STATE_TESTING);
          beep(1, 80, 0);
          Serial.println(F("EVENT, RESUMED"));
        }
        break;

      case STATE_TESTING:
        break;
    }
  }
}

// --- Buzzer ---
void buzzerWrite(bool on) {
#if BUZZER_PASSIVE
  if (on) tone(BUZZER_PIN, BUZZER_FREQ_HZ);
  else    noTone(BUZZER_PIN);
#else
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
#endif
}

// Starts a pattern of `count` beeps; replaces any pattern already playing.
void beep(uint8_t count, unsigned int onMs, unsigned int offMs) {
  if (!BUZZER_ENABLED || count == 0) return;
  beepsLeft     = count;
  beepOnMs      = onMs;
  beepOffMs     = offMs;
  beepIsOn      = true;
  beepChangedAt = millis();
  buzzerWrite(true);
}

void updateBuzzer(unsigned long now) {
  if (beepsLeft == 0) return;
  if (beepIsOn) {
    if (now - beepChangedAt >= beepOnMs) {
      buzzerWrite(false);
      beepIsOn      = false;
      beepChangedAt = now;
      beepsLeft--;
    }
  } else if (now - beepChangedAt >= beepOffMs) {
    buzzerWrite(true);
    beepIsOn      = true;
    beepChangedAt = now;
  }
}

// --- Test Control ---
void loadOn() {
  prevCurrent_mA = -1.0;   // restart trapezoid: load was off before this interval
  conditionSince = 0;
  digitalWrite(GATE_PIN, HIGH);
}

void loadOff() {
  digitalWrite(GATE_PIN, LOW);
}

void clearTest() {
  capacity_mAh   = 0.0;
  testMillis     = 0;
  elapsedTimeSec = 0;
}

void setState(TestState newState) {
  currentState   = newState;
  lowCellWarning = false;
  drawStaticUI();
  updateDynamicUI();
}

// True once `condition` has been continuously true for holdMs.
bool conditionHeld(bool condition, unsigned long now, unsigned long holdMs) {
  if (!condition) {
    conditionSince = 0;
    return false;
  }
  if (conditionSince == 0) conditionSince = now;
  if (now - conditionSince >= holdMs) {
    conditionSince = 0;
    return true;
  }
  return false;
}

void runStateMachine(unsigned long now, unsigned long deltaTime) {
  if (currentState != STATE_TESTING) {
    // Load stays OFF in every other state
    loadOff();
    return;
  }

  testMillis    += deltaTime;
  elapsedTimeSec = testMillis / 1000;

  // Trapezoidal integration: mAh += average mA over the interval * hours
  float avg_mA = (prevCurrent_mA < 0) ? current_mA : (prevCurrent_mA + current_mA) / 2.0;
  capacity_mAh  += avg_mA * (deltaTime / 3600000.0);
  prevCurrent_mA = current_mA;

  // Cutoff: sustained dip below 3.0 V, or immediately below the hard limit
  if (voltage_V <= HARD_CUTOFF_V ||
      conditionHeld(voltage_V <= CUTOFF_VOLTAGE_V, now, CUTOFF_CONFIRM_MS)) {
    loadOff(); // Safeguard cutoff: Turn OFF load
    setState(STATE_COMPLETE);
    beep(3, 500, 300);
    Serial.print(F("RESULT, "));
    Serial.print(capacity_mAh, 1);
    Serial.println(F(" mAh"));
  }
}

// --- Serial Logging ---
void printSerialData() {
  Serial.print(elapsedTimeSec);  Serial.print(F(", "));
  Serial.print(voltage_V, 3);    Serial.print(F(", "));
  Serial.print(current_mA, 1);   Serial.print(F(", "));
  Serial.print(capacity_mAh, 2); Serial.print(F(", "));
  switch (currentState) {
    case STATE_IDLE:     Serial.println(F("IDLE"));        break;
    case STATE_TESTING:  Serial.println(F("DISCHARGING")); break;
    case STATE_PAUSED:   Serial.println(F("PAUSED"));      break;
    case STATE_COMPLETE: Serial.println(F("FINISHED"));    break;
  }
}

// --- Display Rendering Routines ---
void drawStaticUI() {
  tft.fillScreen(ST7735_BLACK);

  // Header bar
  tft.fillRect(0, 0, 160, 16, ST7735_BLUE);
  tft.setTextColor(ST7735_WHITE);
  tft.setTextSize(1);
  tft.setCursor(12, 4);
  tft.print(F("18650 CAPACITY TEST"));

  // Fixed Field Labels
  tft.setCursor(4, 22); tft.print(F("VOLT:"));
  tft.setCursor(4, 36); tft.print(F("CURR:"));
  tft.setCursor(4, 50); tft.print(F("TIME:"));
  tft.setCursor(4, 65); tft.print(F("CAP :"));
}

void updateDynamicUI() {
  tft.setTextSize(1);

  // Status Banner
  tft.fillRect(100, 22, 58, 12, ST7735_BLACK);
  tft.setCursor(100, 22);
  if (lowCellWarning) {
    tft.setTextColor(ST7735_RED);
    tft.print(F("LOW V"));
  } else if (currentState == STATE_IDLE) {
    tft.setTextColor(ST7735_YELLOW);
    tft.print(F("READY"));
  } else if (currentState == STATE_TESTING) {
    tft.setTextColor(ST7735_GREEN);
    tft.print(F("TESTING"));
  } else if (currentState == STATE_PAUSED) {
    tft.setTextColor(ST7735_ORANGE);
    tft.print(F("PAUSED"));
  } else {
    tft.setTextColor(ST7735_RED);
    tft.print(F("DONE"));
  }

  // Voltage
  tft.fillRect(45, 22, 50, 10, ST7735_BLACK);
  tft.setTextColor(ST7735_WHITE);
  tft.setCursor(45, 22);
  tft.print(voltage_V, 2); tft.print(F(" V"));

  // Current
  tft.fillRect(45, 36, 55, 10, ST7735_BLACK);
  tft.setCursor(45, 36);
  tft.print(current_mA, 0); tft.print(F(" mA"));

  // Time (MM:SS)
  tft.fillRect(45, 50, 60, 10, ST7735_BLACK);
  tft.setCursor(45, 50);
  unsigned long mins = elapsedTimeSec / 60;
  unsigned long secs = elapsedTimeSec % 60;
  if (mins < 10) tft.print(F("0"));
  tft.print(mins); tft.print(F(":"));
  if (secs < 10) tft.print(F("0"));
  tft.print(secs);

  // Capacity (Highlighted readout)
  tft.fillRect(45, 64, 110, 14, ST7735_BLACK);
  tft.setTextColor(ST7735_CYAN);
  tft.setTextSize(1);
  tft.setCursor(45, 65);
  tft.print(capacity_mAh, 1); tft.print(F(" mAh"));
}
