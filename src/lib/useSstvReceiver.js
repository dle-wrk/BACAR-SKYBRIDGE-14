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

  const contextRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
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

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* ignore */
    }
  }, []);

  const stop = useCallback(() => {
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
          if (captureHaveRef.current >= targetSamplesRef.current) {
            const total = captureHaveRef.current;
            const audio = new Float32Array(total);
            let offset = 0;
            for (const c of captureBufRef.current) {
              audio.set(c, offset);
              offset += c.length;
            }
            const mode = modeRef.current;
            modeRef.current = null;
            captureBufRef.current = [];
            captureHaveRef.current = 0;
            setDetected(null);
            setState('listening');
            handleCapture(mode, audio, ctx.sampleRate);
          }
        }
      };

      source.connect(worklet);
      // A destination connect isn't strictly required for AudioWorkletNode,
      // but it keeps the graph active on all browsers. We connect to a muted
      // GainNode so the operator doesn't hear their own mic looped back.
      const muteSink = ctx.createGain();
      muteSink.gain.value = 0;
      worklet.connect(muteSink).connect(ctx.destination);
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
  };
}
