import { useCallback, useEffect, useRef, useState } from 'react';
import { VISDetector, DECODERS, MODES, rgbaToPngDataUrl, rgbaToJpegDataUrl, samplesToWavBlob } from '@/lib/sstv';
import { telemetry } from '@/lib/mqttService';

// Rolling buffer window kept while listening — lets the operator save the
// last N seconds of audio at any time, even if the VIS detector didn't lock.
const ROLLING_SECONDS = 60;

// One-stop hook that owns the getUserMedia stream, the AudioContext, and
// the SSTV state machine. Consumers just call start()/stop() and read state.
export function useSstvReceiver() {
  const [state, setState] = useState('idle');   // 'idle' | 'listening' | 'receiving' | 'error'
  const [error, setError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [detected, setDetected] = useState(null); // { mode, startedAt }
  const [captures, setCaptures] = useState([]);   // most recent first
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  // Blind-decode mode: when set, continuously decode the rolling audio
  // buffer as that SSTV mode without waiting for a VIS lock. 'robot36'
  // for a 36 s sliding window, 'martinm1' for 114 s, etc. null = off.
  const [blindMode, setBlindMode] = useState(null);
  const blindModeRef = useRef(null);
  useEffect(() => { blindModeRef.current = blindMode; }, [blindMode]);

  const contextRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  // Mobile background-audio helpers:
  //   - wakeLockRef: Screen Wake Lock keeps the display from sleeping while
  //     listening, which also stops aggressive tab suspension on Android.
  //   - silentNodeRef: a constant 0-amplitude oscillator connected to the
  //     destination so the OS classifies the page as "actively playing media"
  //     and keeps the AudioContext alive when the tab is backgrounded.
  const wakeLockRef = useRef(null);
  const silentNodeRef = useRef(null);
  const modeRef = useRef(null);        // active mode while receiving
  const targetSamplesRef = useRef(0);
  const captureBufRef = useRef([]);
  const captureHaveRef = useRef(0);
  const sampleRateRef = useRef(44100);
  // Rolling buffer of the last N seconds of raw audio — used by saveCurrent()
  // to grab whatever was heard even if VIS never locked.
  const rollingBufRef = useRef([]);   // array of Float32Array chunks
  const rollingHaveRef = useRef(0);   // total samples across chunks
  const rollingMaxRef = useRef(44100 * ROLLING_SECONDS);
  // Live preview — a data-URL of the partial decode updated every ~500 ms
  // while RECEIVING. Lets the viewer watch the image fill in line-by-line.
  const [livePreview, setLivePreview] = useState(null);
  const lastPreviewAtRef = useRef(0);
  const previewBusyRef = useRef(false);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* ignore */
    }
  }, []);

  const stop = useCallback(() => {
    if (silentNodeRef.current) {
      try { silentNodeRef.current.stop(); } catch { /* noop */ }
      silentNodeRef.current = null;
    }
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch { /* noop */ }
      wakeLockRef.current = null;
    }
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
      }
    } catch { /* ignore */ }
    if (contextRef.current) {
      try { contextRef.current.close(); } catch { /* noop */ }
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    detectorRef.current = null;
    modeRef.current = null;
    captureBufRef.current = [];
    captureHaveRef.current = 0;
    setState('idle');
    setDetected(null);
    setAudioLevel(0);
    setLivePreview(null);
    lastPreviewAtRef.current = 0;
    previewBusyRef.current = false;
  }, []);

  const handleCapture = useCallback((mode, audio, sampleRate) => {
    const wavBlob = samplesToWavBlob(audio, sampleRate);
    const wavUrl = URL.createObjectURL(wavBlob);
    const t = Date.now();
    let imagePng = null;
    let imageJpeg = null;
    let imageBytes = 0;
    const decoder = mode.decoder ? DECODERS[mode.decoder] : null;
    if (decoder) {
      try {
        const rgba = decoder(audio, sampleRate);
        imagePng = rgbaToPngDataUrl(rgba);
        imageJpeg = rgbaToJpegDataUrl(rgba, 0.92);
        imageBytes = Math.round(((imagePng.length - 22) * 3) / 4);
      } catch (exc) {
        console.warn('[sstv] decode error', exc);
      }
    }
    const entry = {
      t,
      mode: mode.key,
      modeLabel: mode.label,
      vis: mode.vis,
      seconds: mode.seconds,
      wavUrl,
      wavBytes: wavBlob.size,
      png: imagePng,
      jpeg: imageJpeg,
      imageBytes,
      local: true,
    };
    setCaptures((prev) => [entry, ...prev].slice(0, 20));

    // Broadcast to every other viewer via MQTT so their SSTV tab shows the
    // same image. WAV stays local — too big to sensibly publish. PNG only.
    telemetry.publishSstvCapture({
      event:       'captured',
      status:      'captured',
      role:        'browser',
      mode:        mode.key,
      mode_label:  mode.label,
      vis:         mode.vis,
      seconds:     mode.seconds,
      thumbnail:   imagePng,
      image_bytes: imageBytes,
      wav_bytes:   wavBlob.size,
      duration_s:  Number((audio.length / sampleRate).toFixed(1)),
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const constraints = {
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      contextRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      // Load the AudioWorklet processor. Served from public/ so Vite doesn't
      // bundle it — the worklet runs in a separate audio thread and needs
      // its own script URL to load into that thread.
      await ctx.audioWorklet.addModule('/sstv-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'sstv-capture');
      const detector = new VISDetector(ctx.sampleRate);
      detectorRef.current = detector;
      setState('listening');
      // Refresh device list now that we have permission — labels appear.
      refreshDevices();

      // Reset the rolling buffer state for this session.
      rollingMaxRef.current = ctx.sampleRate * ROLLING_SECONDS;
      rollingBufRef.current = [];
      rollingHaveRef.current = 0;

      worklet.port.onmessage = (ev) => {
        const { chunk, peak } = ev.data;
        setAudioLevel(peak);

        // Append to rolling buffer, drop the oldest chunks past ROLLING_SECONDS
        rollingBufRef.current.push(chunk);
        rollingHaveRef.current += chunk.length;
        while (rollingHaveRef.current > rollingMaxRef.current && rollingBufRef.current.length > 1) {
          const dropped = rollingBufRef.current.shift();
          rollingHaveRef.current -= dropped.length;
        }

        if (modeRef.current === null) {
          // Blind-decode mode — run the chosen decoder over the last
          // mode.seconds of rolling buffer every ~500 ms. Lets the operator
          // watch the image render continuously the moment they hit Start,
          // without waiting for a VIS header.
          const blindKey = blindModeRef.current;
          const blindMode = blindKey
            ? Object.values(MODES).find((m) => m.key === blindKey)
            : null;
          const blindDecoder = blindMode?.decoder ? DECODERS[blindMode.decoder] : null;
          const nowMs = performance.now();
          if (
            blindDecoder &&
            !previewBusyRef.current &&
            nowMs - lastPreviewAtRef.current > 500 &&
            rollingHaveRef.current > ctx.sampleRate * 1
          ) {
            lastPreviewAtRef.current = nowMs;
            previewBusyRef.current = true;
            Promise.resolve().then(() => {
              try {
                // Grab the last blindMode.seconds of rolling audio.
                const want = Math.round(ctx.sampleRate * blindMode.seconds);
                const total = rollingHaveRef.current;
                const take = Math.min(want, total);
                const audio = new Float32Array(take);
                let needed = take;
                let dst = take;
                // Walk the chunk array from the newest end backwards.
                for (let i = rollingBufRef.current.length - 1; i >= 0 && needed > 0; i--) {
                  const c = rollingBufRef.current[i];
                  const copy = Math.min(c.length, needed);
                  audio.set(c.subarray(c.length - copy), dst - copy);
                  dst -= copy;
                  needed -= copy;
                }
                const rgba = blindDecoder(audio, ctx.sampleRate);
                setLivePreview(rgbaToPngDataUrl(rgba));
              } catch (exc) {
                console.warn('[sstv] blind-decode failed', exc);
              } finally {
                previewBusyRef.current = false;
              }
            });
          }

          detector.feed(chunk);
          const hit = detector.scan();
          if (hit) {
            modeRef.current = { ...hit.mode, vis: null };
            for (const [visStr, m] of Object.entries(MODES)) {
              if (m === hit.mode) {
                modeRef.current.vis = `0x${Number(visStr).toString(16).padStart(2, '0').toUpperCase()}`;
              }
            }
            setDetected({ mode: modeRef.current, startedAt: Date.now() });
            setState('receiving');
            const tail = detector.buf.slice(hit.headerEnd);
            captureBufRef.current = [tail];
            captureHaveRef.current = tail.length;
            targetSamplesRef.current = Math.round(ctx.sampleRate * (hit.mode.seconds + 2));
          }
        } else {
          captureBufRef.current.push(chunk);
          captureHaveRef.current += chunk.length;

          // Live progressive preview: every ~500 ms, flatten whatever we have
          // and run the mode's decoder on it. The decoder already pads short
          // audio with zeros, so partial calls yield partial images (the
          // remaining lines come back as black and fill in on the next tick).
          const mode = modeRef.current;
          const decoder = mode?.decoder ? DECODERS[mode.decoder] : null;
          const now = performance.now();
          if (
            decoder &&
            !previewBusyRef.current &&
            now - lastPreviewAtRef.current > 500 &&
            captureHaveRef.current > ctx.sampleRate * 0.5 // have at least 0.5s
          ) {
            lastPreviewAtRef.current = now;
            previewBusyRef.current = true;
            // Build a snapshot without starving the audio thread for long.
            Promise.resolve().then(() => {
              try {
                const total = captureHaveRef.current;
                const partial = new Float32Array(total);
                let off = 0;
                for (const c of captureBufRef.current) {
                  partial.set(c, off);
                  off += c.length;
                }
                const rgba = decoder(partial, ctx.sampleRate);
                setLivePreview(rgbaToPngDataUrl(rgba));
              } catch (exc) {
                console.warn('[sstv] live preview decode failed', exc);
              } finally {
                previewBusyRef.current = false;
              }
            });
          }

          if (captureHaveRef.current >= targetSamplesRef.current) {
            const total = captureHaveRef.current;
            const audio = new Float32Array(total);
            let offset = 0;
            for (const c of captureBufRef.current) {
              audio.set(c, offset);
              offset += c.length;
            }
            const finishedMode = modeRef.current;
            modeRef.current = null;
            captureBufRef.current = [];
            captureHaveRef.current = 0;
            setDetected(null);
            setState('listening');
            setLivePreview(null);
            handleCapture(finishedMode, audio, ctx.sampleRate);
          }
        }
      };

      source.connect(worklet);
      // Mute the worklet output so the operator doesn't hear their own mic
      // looped back. We still need a destination connect to keep the graph
      // scheduled on all browsers.
      const muteSink = ctx.createGain();
      muteSink.gain.value = 0;
      worklet.connect(muteSink).connect(ctx.destination);

      // Background-audio keep-alive — mobile browsers suspend AudioContexts
      // on backgrounded tabs unless the page is actively playing audio.
      // A 0-amplitude oscillator counts as "playing", so iOS Safari / Chrome
      // Android keep the capture going when the user switches apps to play
      // the SSTV source (WhatsApp voice note, YouTube clip, etc.).
      try {
        const silent = ctx.createOscillator();
        silent.frequency.value = 20_000; // out of audible range anyway
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        silent.connect(silentGain).connect(ctx.destination);
        silent.start();
        silentNodeRef.current = silent;
      } catch { /* silent-audio hack is best-effort */ }

      // Keep the screen on while listening — also massively reduces the
      // chance the OS backgrounds the tab.
      try {
        if (navigator.wakeLock?.request) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch { /* wake-lock best effort */ }

      // Tell the OS media-session this page is a running media source so
      // the OS leaves the tab alone and the lock-screen media controls
      // show something meaningful.
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title:  'Skybridge 14 — SSTV Receiver',
            artist: 'Listening for SSTV',
            album:  'BACAR Skybridge 14',
          });
          navigator.mediaSession.playbackState = 'playing';
          navigator.mediaSession.setActionHandler?.('stop', () => stop());
        }
      } catch { /* ignore */ }
    } catch (exc) {
      console.error('[sstv] start failed', exc);
      setError(exc?.message || String(exc));
      setState('error');
      stop();
    }
  }, [handleCapture, refreshDevices, selectedDeviceId, stop]);

  useEffect(() => {
    // Devices without labels until permission is granted, but we can at
    // least know how many inputs exist.
    refreshDevices();
    return () => stop();
  }, [refreshDevices, stop]);

  // Flatten the rolling buffer to a single Float32Array and return a WAV
  // blob URL + metadata. Returns null if the buffer is empty (idle).
  const saveCurrent = useCallback(() => {
    const chunks = rollingBufRef.current;
    const total = rollingHaveRef.current;
    if (total === 0) return null;
    const audio = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      audio.set(c, offset);
      offset += c.length;
    }
    const sampleRate = sampleRateRef.current || 44100;
    const wavBlob = samplesToWavBlob(audio, sampleRate);
    return {
      url:        URL.createObjectURL(wavBlob),
      bytes:      wavBlob.size,
      duration_s: Number((audio.length / sampleRate).toFixed(1)),
    };
  }, []);

  // Decode a WAV File straight through the detector + decoders, bypassing
  // the microphone entirely. Returns a diagnostic report the UI shows to
  // the operator. Great for sanity-checking the decoder against a known
  // clean file when live mic capture is misbehaving.
  const decodeFile = useCallback(async (file) => {
    const arrayBuf = await file.arrayBuffer();
    // Use a one-shot offline context just to decode the WAV. If the file's
    // sample rate differs from our pipeline's 44100, decodeAudioData will
    // resample for us.
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    try {
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      // Mix down to mono (SSTV is mono).
      const length = audioBuf.length;
      const mono = new Float32Array(length);
      for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) {
        const data = audioBuf.getChannelData(ch);
        for (let i = 0; i < length; i++) mono[i] += data[i];
      }
      if (audioBuf.numberOfChannels > 1) {
        for (let i = 0; i < length; i++) mono[i] /= audioBuf.numberOfChannels;
      }
      const sampleRate = audioBuf.sampleRate;

      // Run the entire file through a fresh VIS detector.
      const detector = new (await import('@/lib/sstv')).VISDetector(sampleRate);
      // Feed in ~2k-sample chunks so the detector's rolling buffer and
      // cooldown behave the same as live capture.
      const chunkSize = 2048;
      let hit = null;
      let hitAt = 0;
      for (let i = 0; i < mono.length; i += chunkSize) {
        const chunk = mono.subarray(i, Math.min(i + chunkSize, mono.length));
        detector.feed(chunk);
        const found = detector.scan();
        if (found) {
          hit = found;
          hitAt = i;
          break;
        }
      }
      const report = {
        file_name:   file.name,
        file_bytes:  file.size,
        duration_s:  Number((mono.length / sampleRate).toFixed(1)),
        sample_rate: sampleRate,
        debug:       detector.debug,
      };
      if (!hit) {
        report.result = 'no_vis';
        report.message = 'VIS header not detected in the file.';
        return report;
      }
      report.result = 'detected';
      report.mode = hit.mode.key;
      report.mode_label = hit.mode.label;
      // The audio from the detector buffer at hit.headerEnd onwards is the
      // picture data — reconstruct from the mono buffer using the global
      // sample offset.
      const absHeaderEnd = hitAt + hit.headerEnd;
      const needed = Math.round(sampleRate * (hit.mode.seconds + 2));
      const picture = mono.subarray(absHeaderEnd, absHeaderEnd + needed);
      handleCapture(hit.mode, picture, sampleRate);
      report.message = `Decoded ${hit.mode.label} starting ${(hitAt / sampleRate).toFixed(1)}s into the file.`;
      return report;
    } finally {
      try { ctx.close(); } catch { /* noop */ }
    }
  }, [handleCapture]);

  // Snapshot of the detector's debug counters — the UI reads this to help
  // diagnose why VIS didn't fire (heard the leader? read a byte? matched a
  // known mode?).
  const getDebug = useCallback(() => {
    const d = detectorRef.current?.debug;
    if (!d) return null;
    return {
      leader_hits: d.leader_hits,
      start_hits:  d.start_hits,
      vis_reads:   d.vis_reads,
      vis_matched: d.vis_matched,
      vis_unknown: d.vis_unknown,
      last_vis:    d.last_vis,
      last_leader_freq: d.last_leader_freq,
      last_start_freq:  d.last_start_freq,
    };
  }, []);

  return {
    state,
    error,
    audioLevel,
    detected,
    captures,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    start,
    stop,
    refreshDevices,
    saveCurrent,
    getDebug,
    decodeFile,
    livePreview,
    blindMode,
    setBlindMode,
  };
}
