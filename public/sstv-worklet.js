// AudioWorkletProcessor that batches raw mic audio into ~46 ms chunks and
// posts them to the main thread. This replaces the deprecated
// ScriptProcessorNode path in useSstvReceiver.js — same audio flow, but
// runs in the real-time audio thread and no longer triggers the "Slow
// path" console warning.
//
// process() is called with 128 mono samples per input at whatever the
// context's sample rate is. We accumulate BATCH_SIZE samples in a
// persistent buffer, then transfer it (zero-copy) to the main thread and
// allocate a fresh buffer for the next batch. Peak amplitude for the VU
// meter piggy-backs on the same message.

const BATCH_SIZE = 2048;

class SstvCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH_SIZE);
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.buffer[this.filled++] = s;
      const abs = s < 0 ? -s : s;
      if (abs > this.peak) this.peak = abs;
      if (this.filled >= BATCH_SIZE) {
        const out = this.buffer;
        const peakSnapshot = this.peak;
        this.buffer = new Float32Array(BATCH_SIZE);
        this.filled = 0;
        this.peak = 0;
        // Transfer the ArrayBuffer instead of copying — the worklet no
        // longer references `out` after this line.
        this.port.postMessage({ chunk: out, peak: peakSnapshot }, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('sstv-capture', SstvCaptureProcessor);
