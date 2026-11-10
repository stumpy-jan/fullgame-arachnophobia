// Sound, synthesised in Web Audio (nothing to download, after Skyward's audio.js). Starts on the first key or
// click (browsers allow audio only after one). sfx(name, gain) plays a one-shot; the ambience (a low facility
// hum and a far-off two-tone siren) runs underneath.
let ac = null, master = null, noiseBuf = null;

function start() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ambience();
}
addEventListener('keydown', start, { once: false });
addEventListener('mousedown', start, { once: false });

const now = () => ac.currentTime;
function env(g, t0, a, peak, decay) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + decay); }
function noise(t0, dur, filter, freq, q, peak, decay, out = master) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = ac.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); env(g, t0, 0.004, peak, decay);
  s.connect(f).connect(g).connect(out); s.start(t0, Math.random() * 1.5, dur);
  return f;
}
function tone(t0, type, f0, f1, peak, decay, out = master) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + decay);
  const g = ac.createGain(); env(g, t0, 0.005, peak, decay);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + decay + 0.05);
}

const last = {};
export function sfx(name, gain = 1) {
  if (!ac || gain < 0.02) return;
  const t = now();
  if (last[name] && t - last[name] < (LIMIT[name] ?? 0.03)) return; // no machine-gun stacking of one sound
  last[name] = t;
  const k = gain;
  switch (name) {
    case 'step': tone(t, 'sine', 70, 38, 0.35 * k, 0.16); noise(t, 0.12, 'lowpass', 300, 0.7, 0.18 * k, 0.1); break;
    case 'slash': noise(t, 0.2, 'bandpass', 2400, 0.8, 0.35 * k, 0.12); noise(t + 0.06, 0.25, 'lowpass', 600, 1, 0.5 * k, 0.2); tone(t + 0.06, 'triangle', 160, 60, 0.25 * k, 0.15); break;
    case 'shot': noise(t, 0.2, 'bandpass', 1600, 0.6, 0.45 * k, 0.09); tone(t, 'square', 220, 70, 0.08 * k, 0.06); break;
    case 'glass':
      for (let i = 0; i < 9; i++) { const dt = Math.random() * 0.35; tone(t + dt, 'sine', 2500 + Math.random() * 3500, 1800, 0.05 * k, 0.12 + Math.random() * 0.2); }
      noise(t, 0.4, 'highpass', 3000, 0.7, 0.4 * k, 0.35); break;
    case 'metal': noise(t, 0.15, 'bandpass', 900, 3, 0.4 * k, 0.12); tone(t, 'triangle', 420 + Math.random() * 200, 300, 0.12 * k, 0.4); break;
    case 'boom': noise(t, 1.6, 'lowpass', 500, 0.7, 0.9 * k, 1.4); tone(t, 'sine', 90, 28, 0.8 * k, 1.2); break;
    case 'land': noise(t, 0.6, 'lowpass', 260, 0.8, 0.8 * k, 0.5); tone(t, 'sine', 65, 25, 0.9 * k, 0.6); break;
    case 'quill': noise(t, 0.25, 'bandpass', 3200, 1.5, 0.18 * k, 0.15); break;
    case 'door': noise(t, 3.2, 'lowpass', 140, 1, 0.6 * k, 3.0); tone(t, 'sawtooth', 48, 40, 0.15 * k, 3.0); break;
    case 'squelch': noise(t, 0.3, 'lowpass', 500, 4, 0.5 * k, 0.25); tone(t, 'sine', 140, 50, 0.25 * k, 0.2); break;
  }
}
const LIMIT = { step: 0.05, shot: 0.02, metal: 0.06, quill: 0.05, squelch: 0.05 };

// the facility hum and the siren, quiet, under everything
function ambience() {
  const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 50;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
  const g = ac.createGain(); g.gain.value = 0.05;
  hum.connect(lp).connect(g).connect(master); hum.start();
  const siren = ac.createOscillator(); siren.type = 'triangle'; siren.frequency.value = 600;
  const lfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.55;
  const lfoG = ac.createGain(); lfoG.gain.value = 110; lfo.connect(lfoG).connect(siren.frequency);
  const sf = ac.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 650; sf.Q.value = 2;
  const sg = ac.createGain(); sg.gain.value = 0.018;
  siren.connect(sf).connect(sg).connect(master); siren.start(); lfo.start();
}

// how loud a sound at (x, z) is for a listener at (lx, lz): full within 8 m, gone by 45
export const falloff = (x, z, lx, lz) => Math.max(0, Math.min(1, 1 - (Math.hypot(x - lx, z - lz) - 8) / 37));
