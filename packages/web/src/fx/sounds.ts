// Web Audio API ベースの SE モジュール。
// 実装は docs 参考の index_sound.html からポート。
// AudioContext は autoplay ポリシー上、初回ユーザジェスチャ内で resume する必要がある。
// 各再生関数の内部で ensureAudioContext() を呼ぶので、イベントハンドラから叩けば良い。

let audioCtx: AudioContext | null = null;

/**
 * AudioContext を先にユーザジェスチャ内で生成・resume する用途の公開 API。
 * Chrome の autoplay policy 上、初回の user gesture 中に resume しておかないと
 * 後からタイマーや socket 経路で playXxx() を呼んでも無音になることがある。
 */
export function unlockAudio(): void {
  ensureAudioContext();
}

function ensureAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      throw new Error("Web Audio API is not available");
    }
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

// --- Drumroll (ロール + 最後にシンバル) --------------------------------
function createDrumSounds(ctx: AudioContext) {
  const bufferSize = ctx.sampleRate * 2.0;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const playHit = (time: number, volume: number) => {
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 600;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(time);

    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(55, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
    oscGain.gain.setValueAtTime(volume * 1.0, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
  };

  const playCymbal = (time: number) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 4000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 1.5);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(time);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "triangle";
    boom.frequency.setValueAtTime(50, time);
    boomGain.gain.setValueAtTime(0.8, time);
    boomGain.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(time);
    boom.stop(time + 0.6);
  };

  return { playHit, playCymbal };
}

export function playDrumroll(durationSec = 1.5): void {
  const ctx = ensureAudioContext();
  const { playHit, playCymbal } = createDrumSounds(ctx);
  const startTime = ctx.currentTime;
  const hitInterval = 0.05;
  for (let t = 0; t < durationSec; t += hitInterval) {
    playHit(startTime + t, 0.5 + Math.random() * 0.5);
  }
  window.setTimeout(() => {
    playCymbal(ensureAudioContext().currentTime);
  }, durationSec * 1000);
}

// --- Fanfare (ファンファーレ) --------------------------------------------
function playTrumpetNote(
  ctx: AudioContext,
  freq: number,
  time: number,
  duration: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, time);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(200, time);
  filter.frequency.exponentialRampToValueAtTime(3000, time + 0.05);
  filter.frequency.exponentialRampToValueAtTime(1000, time + duration);
  filter.Q.value = 5;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.4, time + 0.02);
  gain.gain.setValueAtTime(0.4, time + duration - 0.05);
  gain.gain.linearRampToValueAtTime(0, time + duration);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + duration);
}

export function playFanfare(): void {
  const ctx = ensureAudioContext();
  const now = ctx.currentTime;
  playTrumpetNote(ctx, 261.63, now, 0.15);
  playTrumpetNote(ctx, 261.63, now + 0.2, 0.15);
  playTrumpetNote(ctx, 392.0, now + 0.4, 0.15);
  playTrumpetNote(ctx, 392.0, now + 0.6, 0.15);
  playTrumpetNote(ctx, 523.25, now + 0.8, 0.6);
}

// --- Shishi-odoshi (ししおどしの「カツン」) -----------------------------
export function playShishi(): void {
  const ctx = ensureAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const bodyOsc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(500, now + 0.1);
  bodyOsc.type = "triangle";
  bodyOsc.frequency.setValueAtTime(520, now);
  filter.type = "bandpass";
  filter.frequency.value = 700;
  filter.Q.value = 2;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.6, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(filter);
  bodyOsc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  bodyOsc.start(now);
  osc.stop(now + 0.3);
  bodyOsc.stop(now + 0.3);
}

// --- Temple bell (寺の鐘の「ゴーン」) ------------------------------------
export function playBell(): void {
  const ctx = ensureAudioContext();
  const now = ctx.currentTime;
  const partials = [120, 240.5, 312, 360, 480];

  partials.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    const decay = index === 0 ? 5.0 : 3.0 - index * 0.4;
    const vol = index === 0 ? 0.5 : 0.2 / index;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + decay);
  });

  const noise = ctx.createBufferSource();
  const bufferSize = ctx.sampleRate * 0.1;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  const nFilter = ctx.createBiquadFilter();
  nFilter.type = "lowpass";
  nFilter.frequency.value = 400;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.4, now);
  nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  noise.connect(nFilter);
  nFilter.connect(nGain);
  nGain.connect(ctx.destination);
  noise.start(now);
}

// --- BGM (簡易 melody loop) ----------------------------------------------
const bgmMelody: Array<{ f: number; d: number }> = [
  { f: 261.63, d: 0.2 }, { f: 329.63, d: 0.2 }, { f: 392.0, d: 0.2 }, { f: 523.25, d: 0.2 },
  { f: 440.0, d: 0.2 }, { f: 349.23, d: 0.2 }, { f: 392.0, d: 0.4 },
  { f: 293.66, d: 0.2 }, { f: 349.23, d: 0.2 }, { f: 440.0, d: 0.2 }, { f: 587.33, d: 0.2 },
  { f: 493.88, d: 0.2 }, { f: 392.0, d: 0.2 }, { f: 523.25, d: 0.4 },
];
let bgmPlaying = false;
let bgmTimer: number | null = null;
let bgmIdx = 0;

function bgmTick() {
  if (!bgmPlaying || !audioCtx) return;
  const note = bgmMelody[bgmIdx];
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(note.f, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + note.d);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + note.d);
  bgmIdx = (bgmIdx + 1) % bgmMelody.length;
  bgmTimer = window.setTimeout(bgmTick, note.d * 1000);
}

export function toggleBgm(): boolean {
  ensureAudioContext();
  if (bgmPlaying) {
    bgmPlaying = false;
    if (bgmTimer !== null) {
      window.clearTimeout(bgmTimer);
      bgmTimer = null;
    }
  } else {
    bgmPlaying = true;
    bgmIdx = 0;
    bgmTick();
  }
  return bgmPlaying;
}
