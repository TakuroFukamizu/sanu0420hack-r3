#include <M5Unified.h>

constexpr int OUT_PIN_A = 19;
constexpr int OUT_PIN_B = 21;

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);

  pinMode(OUT_PIN_A, OUTPUT);
  pinMode(OUT_PIN_B, OUTPUT);
  digitalWrite(OUT_PIN_A, LOW);
  digitalWrite(OUT_PIN_B, LOW);
}

void loop() {
  M5.update();

  const int level = M5.BtnA.isPressed() ? HIGH : LOW;
  digitalWrite(OUT_PIN_A, level);
  digitalWrite(OUT_PIN_B, level);

  delay(10);
}
