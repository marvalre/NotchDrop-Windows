// A real alarm-clock pattern (four quick beeps, a short rest, repeat), synthesized with
// Web Audio so nothing ships as a sound file. Same idea as AlarmTone in the macOS app.
let ctx: AudioContext | null = null;
let timer: number | null = null;

function beepBurst(c: AudioContext, at: number) {
  for (let i = 0; i < 4; i++) {
    const t = at + i * 0.13;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.value = i % 2 ? 1046 : 880;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.005);
    gain.gain.setValueAtTime(0.18, t + 0.08);
    gain.gain.linearRampToValueAtTime(0, t + 0.09);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

export function startAlarmTone() {
  stopAlarmTone();
  ctx = ctx ?? new AudioContext();
  void ctx.resume();
  const c = ctx;
  beepBurst(c, c.currentTime + 0.02);
  timer = window.setInterval(() => beepBurst(c, c.currentTime + 0.02), 1000);
}

export function stopAlarmTone() {
  if (timer !== null) { clearInterval(timer); timer = null; }
}

/** Called from a click so later alarms can play even without a fresh user gesture. */
export function primeAudio() {
  try { ctx = ctx ?? new AudioContext(); void ctx.resume(); } catch { /* no audio device */ }
}
