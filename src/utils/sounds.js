let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function tone({ frequency, duration, type = 'sine', volume = 0.08, stagger = 0 }) {
  const ctx = getCtx();
  if (!ctx) return;

  const start = ctx.currentTime + stagger;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Soft rising blip after a successful send. */
export function playSendSound() {
  try {
    tone({ frequency: 660, duration: 0.07, type: 'triangle', volume: 0.06 });
    tone({ frequency: 880, duration: 0.09, type: 'triangle', volume: 0.05, stagger: 0.06 });
  } catch {
    // ignore autoplay / unsupported audio
  }
}

/** Soft two-tone chime for an incoming message. */
export function playReceiveSound() {
  try {
    tone({ frequency: 520, duration: 0.09, type: 'sine', volume: 0.07 });
    tone({ frequency: 780, duration: 0.12, type: 'sine', volume: 0.06, stagger: 0.08 });
  } catch {
    // ignore
  }
}
