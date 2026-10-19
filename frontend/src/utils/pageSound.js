/* The sound a page makes.

   Synthesised rather than shipped: no megabyte of MP3 to fetch before the first
   turn feels right, and every turn can differ a little — a recorded sample
   played forty times in a row starts to sound like a machine, which is the
   opposite of the effect.

   The first version of this was two swept noise swells, and it sounded like
   wind, because that is what a smooth noise swell is. Paper is not smooth. It
   is a dense train of tiny snaps as the fibres buckle, each one a few hundred
   microseconds long, irregular in both spacing and loudness. So the bed is
   built that way — sparse micro-impulses over a floor of hiss — and the filters
   only colour it. Moving the sheet faster packs the snaps closer, which is what
   `playbackRate` does for free.

   A turn is three gestures, not one: the sheet sweeping up off the stack, the
   sharper release as it goes over, and a soft low pat as it lands on the other
   side. Dropping any of the three is what made it read as an effect rather than
   as a page.

   This is a UI sound, not a second player: it is quiet, under half a second,
   and it does not touch the audio element or the YouTube dock. The "never two
   sounds at once" rule is about music, and a page rustling over the song you
   are reading along to is the point of the page.

   Off is remembered, because somebody will want it off. */

const KEY = "reelody.page-sound";

let ctx = null;
let bed = null;
let on = read();

function read() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    // Private windows throw on the mere mention of localStorage.
    return true;
  }
}

export function pageSoundOn() {
  return on;
}

export function setPageSound(next) {
  on = Boolean(next);
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not remembering it is survivable; refusing to turn it off is not */
  }
}

// Built on first use, not at import: a context created before a gesture starts
// suspended, and Safari counts one against you either way.
function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Two seconds of crinkle, made once and then read from at random offsets and
 * speeds. A floor of quiet hiss with sharp micro-snaps scattered over it: the
 * snaps are what the ear hears as paper, the hiss is what stops the gaps
 * between them sounding like silence.
 */
function crinkle(ac) {
  if (bed) return bed;
  const sr = ac.sampleRate;
  const n = Math.floor(sr * 2);
  bed = ac.createBuffer(1, n, sr);
  const d = bed.getChannelData(0);

  for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * 0.1;

  let i = 0;
  while (i < n) {
    // 0.8–7ms apart, so a normal playback rate puts a few hundred of them in
    // the quarter second a turn lasts.
    i += Math.floor((0.0008 + Math.random() * 0.0062) * sr);
    // Squaring keeps the loud ones rare. An even spread of amplitudes is
    // static; paper is mostly small ticks with the occasional crack.
    const amp = Math.random() ** 2;
    const len = Math.floor((0.0004 + Math.random() * 0.0022) * sr);
    for (let k = 0; k < len && i + k < n; k += 1) {
      const fall = 1 - k / len;
      d[i + k] += (Math.random() * 2 - 1) * amp * fall * fall;
    }
  }

  let peak = 0;
  for (let k = 0; k < n; k += 1) peak = Math.max(peak, Math.abs(d[k]));
  if (peak > 0) for (let k = 0; k < n; k += 1) d[k] /= peak;
  return bed;
}

function source(ac, rate) {
  const src = ac.createBufferSource();
  src.buffer = crinkle(ac);
  src.playbackRate.value = rate;
  return src;
}

/** The sheet travelling: crinkle through a band that moves as it goes over. */
function sweep(ac, at, { gain, len, from, to, q, rate, floor }) {
  const src = source(ac, rate);

  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = q;
  band.frequency.setValueAtTime(from, at);
  band.frequency.exponentialRampToValueAtTime(to, at + len);

  // Anything under this is thump, and thump is not paper.
  const cut = ac.createBiquadFilter();
  cut.type = "highpass";
  cut.frequency.value = floor;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  amp.gain.exponentialRampToValueAtTime(gain * 0.6, at + len * 0.55);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);

  src.connect(band).connect(cut).connect(amp).connect(ac.destination);
  src.start(at, Math.random() * 1.5, len + 0.03);
  src.stop(at + len + 0.03);
}

/** The sheet landing on the stack: the same crinkle with the top taken off. */
function pat(ac, at, { gain, len }) {
  const src = source(ac, 0.6);

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 520;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);

  src.connect(lp).connect(amp).connect(ac.destination);
  src.start(at, Math.random() * 1.5, len + 0.02);
  src.stop(at + len + 0.02);
}

function wake(ac) {
  if (ac.state === "suspended") ac.resume().catch(() => {});
}

// A little either side of 1, so no two turns are quite the same.
function jitter(spread = 0.12) {
  return 1 + (Math.random() * 2 - 1) * spread;
}

/** A whole turn: the sheet lifting, going over, and landing. */
export function playPageTurn() {
  if (!on) return;
  const ac = context();
  if (!ac) return;
  wake(ac);
  const t = ac.currentTime + 0.005;

  sweep(ac, t, {
    gain: 0.05,
    len: 0.26 * jitter(),
    from: 1500,
    to: 3300,
    q: 0.55,
    rate: 1 * jitter(0.18),
    floor: 1100,
  });
  sweep(ac, t + 0.185 * jitter(0.08), {
    gain: 0.08,
    len: 0.13,
    from: 3100,
    to: 1250,
    q: 0.8,
    rate: 1.5 * jitter(0.18),
    floor: 800,
  });
  pat(ac, t + 0.235 * jitter(0.06), { gain: 0.028, len: 0.07 });
}

/** The smaller sound of a corner being picked up — a drag starting. */
export function playPageLift() {
  if (!on) return;
  const ac = context();
  if (!ac) return;
  wake(ac);
  sweep(ac, ac.currentTime + 0.005, {
    gain: 0.022,
    len: 0.09,
    from: 2200,
    to: 3000,
    q: 1.1,
    rate: 0.8 * jitter(),
    floor: 1400,
  });
}
