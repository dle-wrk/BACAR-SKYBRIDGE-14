// In-browser SSTV receiver DSP.
//
// Continuously listens to a Web Audio input, scans for the VIS start
// signature every ~15 ms, identifies the mode, records the following
// picture data, and decodes Robot 36 or Martin M1 to a canvas.
//
// All fixed-time constants are in ms so timing edits stay legible.

// ============================================================
// VIS TABLE
// ============================================================
export const MODES = {
  0x08: { key: 'robot36',   label: 'Robot 36',   seconds: 36.0,  lines: 240, width: 320, decoder: 'robot36'  },
  0x0C: { key: 'robot72',   label: 'Robot 72',   seconds: 72.0,  lines: 240, width: 320, decoder: null       },
  0x20: { key: 'martinm2',  label: 'Martin M2',  seconds: 58.0,  lines: 256, width: 320, decoder: null       },
  0x2C: { key: 'martinm1',  label: 'Martin M1',  seconds: 114.0, lines: 256, width: 320, decoder: 'martinm1' },
  0x38: { key: 'scottieS2', label: 'Scottie S2', seconds: 71.0,  lines: 256, width: 320, decoder: null       },
  0x3C: { key: 'scottieS1', label: 'Scottie S1', seconds: 110.0, lines: 256, width: 320, decoder: null       },
  0x4C: { key: 'scottieDX', label: 'Scottie DX', seconds: 269.0, lines: 256, width: 320, decoder: null       },
  0x5D: { key: 'pd50',      label: 'PD 50',      seconds: 50.0,  lines: 496, width: 640, decoder: null       },
  0x63: { key: 'pd90',      label: 'PD 90',      seconds: 90.0,  lines: 496, width: 640, decoder: null       },
  0x5F: { key: 'pd120',     label: 'PD 120',     seconds: 120.0, lines: 496, width: 640, decoder: null       },
  0x60: { key: 'pd160',     label: 'PD 160',     seconds: 160.0, lines: 496, width: 640, decoder: null       },
  0x61: { key: 'pd180',     label: 'PD 180',     seconds: 180.0, lines: 496, width: 640, decoder: null       },
  0x62: { key: 'pd240',     label: 'PD 240',     seconds: 240.0, lines: 496, width: 640, decoder: null       },
};

// ============================================================
// FFT — iterative Cooley-Tukey (radix 2)
// ============================================================
// n must be a power of two. re[]/im[] are modified in place.
function fftInPlace(re, im) {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const tr = cr * re[i + k + half] - ci * im[i + k + half];
        const ti = cr * im[i + k + half] + ci * re[i + k + half];
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Dominant frequency (Hz) in a band, using a Hann-windowed FFT.
export function dominantFreq(samples, sampleRate, lo, hi) {
  const n = nextPow2(samples.length);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  // Hann window across the input, then zero-pad up to n.
  const len = samples.length;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    re[i] = samples[i] * w;
  }
  fftInPlace(re, im);
  const df = sampleRate / n;
  const loBin = Math.max(1, Math.floor(lo / df));
  const hiBin = Math.min(n / 2, Math.ceil(hi / df));
  let peak = -Infinity;
  let peakBin = loBin;
  for (let k = loBin; k <= hiBin; k++) {
    const mag = re[k] * re[k] + im[k] * im[k];
    if (mag > peak) {
      peak = mag;
      peakBin = k;
    }
  }
  return peakBin * df;
}

// ============================================================
// Instantaneous frequency via Hilbert transform (numpy-style).
// Returns a Float32Array the same length as x.
// ============================================================
export function instantaneousFreq(x, sampleRate) {
  const n = nextPow2(x.length);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fftInPlace(re, im);
  // Analytic signal: zero out negative frequencies, double positive.
  const half = n / 2;
  for (let k = 1; k < half; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = half + 1; k < n; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  // IFFT: swap re/im, forward FFT, swap back and divide by n.
  fftInPlace(im, re);
  const analyticRe = new Float32Array(x.length);
  const analyticIm = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    analyticRe[i] = re[i] / n;
    analyticIm[i] = im[i] / n;
  }
  // Instantaneous phase, unwrap, differentiate.
  const phase = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    phase[i] = Math.atan2(analyticIm[i], analyticRe[i]);
  }
  const unwrapped = new Float32Array(x.length);
  unwrapped[0] = phase[0];
  for (let i = 1; i < x.length; i++) {
    let d = phase[i] - phase[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped[i] = unwrapped[i - 1] + d;
  }
  const freqs = new Float32Array(x.length);
  const k = sampleRate / (2 * Math.PI);
  for (let i = 1; i < x.length; i++) {
    freqs[i] = (unwrapped[i] - unwrapped[i - 1]) * k;
  }
  freqs[0] = freqs[1];
  return freqs;
}

// Slice `freqs` between two ms offsets, bucket to `outWidth` bins.
export function sampleLine(freqs, sampleRate, startMs, endMs, outWidth) {
  const s = Math.round((sampleRate * startMs) / 1000);
  const e = Math.round((sampleRate * endMs) / 1000);
  const seg = freqs.subarray(s, e);
  const out = new Float32Array(outWidth);
  if (seg.length === 0) return out;
  for (let i = 0; i < outWidth; i++) {
    const a = Math.floor((i * seg.length) / outWidth);
    const b = Math.floor(((i + 1) * seg.length) / outWidth);
    let sum = 0;
    for (let j = a; j < b; j++) sum += seg[j];
    out[i] = (b > a) ? sum / (b - a) : seg[a] || 0;
  }
  return out;
}

// SSTV FSK: 1500 Hz -> 0, 2300 Hz -> 255.
export function freqToPixel(f) {
  if (f < 1500) return 0;
  if (f > 2300) return 255;
  return Math.round(((f - 1500) / 800) * 255);
}

// ============================================================
// VIS HEADER DETECTOR
// ============================================================
const VIS = {
  LEADER_HZ: 1900,
  START_HZ:  1200,
  BIT_MS:    30,
  MIN_LEADER_MS: 200,
  POST_START_MS: 300, // 10 * 30ms (8 vis + parity + stop)
};

export class VISDetector {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.buf = new Float32Array(0);
    this.bitN = Math.round((sampleRate * VIS.BIT_MS) / 1000);
    this.leaderN = Math.round((sampleRate * VIS.MIN_LEADER_MS) / 1000);
    this.postN = Math.round((sampleRate * VIS.POST_START_MS) / 1000);
    this.headerN = this.leaderN + this.bitN + this.postN;
    this.bufMax = sampleRate * 4;
    this.scanStride = Math.round(sampleRate * 0.015);
    this.lastScanPos = 0;
    this.cooldownUntil = 0;
  }

  feed(chunk) {
    // append chunk (Float32Array) to buffer
    const combined = new Float32Array(this.buf.length + chunk.length);
    combined.set(this.buf, 0);
    combined.set(chunk, this.buf.length);
    if (combined.length > this.bufMax) {
      const drop = combined.length - this.bufMax;
      this.buf = combined.subarray(drop);
      this.lastScanPos = Math.max(0, this.lastScanPos - drop);
    } else {
      this.buf = combined;
    }
  }

  scan() {
    if (performance.now() < this.cooldownUntil) return null;
    if (this.buf.length < this.headerN) return null;
    const end = this.buf.length - this.postN;
    let pos = Math.max(this.leaderN, this.lastScanPos);
    while (pos < end) {
      if (this._isStartAt(pos) && this._isLeaderBefore(pos)) {
        const mode = this._readVisAfter(pos);
        if (mode) {
          const headerEnd = pos + this.bitN + this.postN;
          this.lastScanPos = headerEnd;
          this.cooldownUntil = performance.now() + 1000;
          return { mode, headerEnd };
        }
      }
      pos += this.scanStride;
    }
    this.lastScanPos = end;
    return null;
  }

  _isStartAt(pos) {
    const seg = this.buf.subarray(pos, pos + this.bitN);
    if (seg.length < this.bitN) return false;
    const f = dominantFreq(seg, this.sr, 1000, 1500);
    return Math.abs(f - VIS.START_HZ) < 80;
  }

  _isLeaderBefore(pos) {
    for (const offsetMs of [60, 140]) {
      const start = pos - Math.round((this.sr * offsetMs) / 1000);
      if (start < 0) return false;
      const seg = this.buf.subarray(start, start + Math.round(this.sr * 0.06));
      const f = dominantFreq(seg, this.sr, 1500, 2200);
      if (Math.abs(f - VIS.LEADER_HZ) > 100) return false;
    }
    return true;
  }

  _readVisAfter(startBitPos) {
    const visStart = startBitPos + this.bitN;
    let vis = 0;
    for (let i = 0; i < 8; i++) {
      const seg = this.buf.subarray(visStart + i * this.bitN, visStart + (i + 1) * this.bitN);
      if (seg.length < this.bitN) return null;
      const f = dominantFreq(seg, this.sr, 1000, 1400);
      const bit = Math.abs(f - 1100) < Math.abs(f - 1300) ? 1 : 0;
      vis |= bit << i;
    }
    return MODES[vis] || MODES[vis & 0x7f] || null;
  }
}

// ============================================================
// DECODERS
// ============================================================
export function decodeRobot36(audio, sampleRate) {
  const width = 320;
  const height = 240;
  const chromaW = 160;
  const lineMs = 150;
  const lineN = Math.round((sampleRate * lineMs) / 1000);
  const totalNeeded = lineN * height;
  let a = audio;
  if (a.length < totalNeeded) {
    const padded = new Float32Array(totalNeeded);
    padded.set(a, 0);
    a = padded;
  } else if (a.length > totalNeeded) {
    a = a.subarray(0, totalNeeded);
  }
  const freqs = instantaneousFreq(a, sampleRate);
  const yPlane = new Uint8ClampedArray(height * width);
  const ryPlane = new Uint8ClampedArray(height * chromaW);
  const byPlane = new Uint8ClampedArray(height * chromaW);
  const haveRy = new Uint8Array(height);
  const haveBy = new Uint8Array(height);

  for (let row = 0; row < height; row++) {
    const rowFreqs = freqs.subarray(row * lineN, (row + 1) * lineN);
    const yFreqs = sampleLine(rowFreqs, sampleRate, 12,    100,   width);
    const cFreqs = sampleLine(rowFreqs, sampleRate, 106.5, 149.5, chromaW);
    for (let x = 0; x < width; x++) yPlane[row * width + x] = freqToPixel(yFreqs[x]);
    if (row % 2 === 1) {
      for (let x = 0; x < chromaW; x++) ryPlane[row * chromaW + x] = freqToPixel(cFreqs[x]);
      haveRy[row] = 1;
    } else {
      for (let x = 0; x < chromaW; x++) byPlane[row * chromaW + x] = freqToPixel(cFreqs[x]);
      haveBy[row] = 1;
    }
  }
  // Fill missing rows from nearest neighbour.
  for (let row = 0; row < height; row++) {
    if (!haveRy[row]) {
      const src = row > 0 ? (row - 1) : (row + 1);
      for (let x = 0; x < chromaW; x++) ryPlane[row * chromaW + x] = ryPlane[src * chromaW + x];
    }
    if (!haveBy[row]) {
      const src = row > 0 ? (row - 1) : (row + 1);
      for (let x = 0; x < chromaW; x++) byPlane[row * chromaW + x] = byPlane[src * chromaW + x];
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < width; x++) {
      const cx = x >> 1;
      const y  = yPlane[row * width + x];
      const ry = ryPlane[row * chromaW + cx] - 128;
      const by = byPlane[row * chromaW + cx] - 128;
      const r  = y + 1.402 * ry;
      const b  = y + 1.772 * by;
      const g  = y - 0.344 * by - 0.714 * ry;
      const idx = (row * width + x) * 4;
      rgba[idx]     = Math.max(0, Math.min(255, r));
      rgba[idx + 1] = Math.max(0, Math.min(255, g));
      rgba[idx + 2] = Math.max(0, Math.min(255, b));
      rgba[idx + 3] = 255;
    }
  }
  return { rgba, width, height };
}

export function decodeMartinM1(audio, sampleRate) {
  const width = 320;
  const height = 256;
  const lineMs = 446.446;
  const syncMs = 4.862;
  const porchMs = 0.572;
  const chMs = 146.432;
  const greenStart = syncMs + porchMs;
  const blueStart  = greenStart + chMs + porchMs;
  const redStart   = blueStart  + chMs + porchMs;
  const lineN = Math.round((sampleRate * lineMs) / 1000);
  const totalNeeded = lineN * height;
  let a = audio;
  if (a.length < totalNeeded) {
    const padded = new Float32Array(totalNeeded);
    padded.set(a, 0);
    a = padded;
  } else if (a.length > totalNeeded) {
    a = a.subarray(0, totalNeeded);
  }
  const freqs = instantaneousFreq(a, sampleRate);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const rowFreqs = freqs.subarray(row * lineN, (row + 1) * lineN);
    const gF = sampleLine(rowFreqs, sampleRate, greenStart, greenStart + chMs, width);
    const bF = sampleLine(rowFreqs, sampleRate, blueStart,  blueStart  + chMs, width);
    const rF = sampleLine(rowFreqs, sampleRate, redStart,   redStart   + chMs, width);
    for (let x = 0; x < width; x++) {
      const idx = (row * width + x) * 4;
      rgba[idx]     = freqToPixel(rF[x]);
      rgba[idx + 1] = freqToPixel(gF[x]);
      rgba[idx + 2] = freqToPixel(bF[x]);
      rgba[idx + 3] = 255;
    }
  }
  return { rgba, width, height };
}

export const DECODERS = {
  robot36:  decodeRobot36,
  martinm1: decodeMartinM1,
};

// Convert an rgba result into a PNG data URL for display + download.
export function rgbaToPngDataUrl({ rgba, width, height }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = new ImageData(rgba, width, height);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// Convert captured mono Float32 audio (at any sample rate) to a WAV blob.
export function samplesToWavBlob(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
