import { useCallback, useEffect, useRef, useState } from 'react';
import { VISDetector, DECODERS, MODES, rgbaToPngDataUrl, samplesToWavBlob } from '@/lib/sstv';
import { telemetry } from '@/lib/mqttService';

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
    let imageBytes = 0;
    const decoder = mode.decoder ? DECODERS[mode.decoder] : null;
    if (decoder) {
      try {
        const rgba = decoder(audio, sampleRate);
        imagePng = rgbaToPngDataUrl(rgba);
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
      const source = ctx.createMediaStreamSource(stream);
      const bufSize = 4096;
      const processor = ctx.createScriptProcessor(bufSize, 1, 1);
      const detector = new VISDetector(ctx.sampleRate);
      detectorRef.current = detector;
      setState('listening');
      // Refresh device list now that we have permission — labels appear.
      refreshDevices();

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        // Copy — the buffer is reused.
        const chunk = new Float32Array(input.length);
        chunk.set(input);
        // Peak level for the meter
        let peak = 0;
        for (let i = 0; i < chunk.length; i++) {
          const abs = Math.abs(chunk[i]);
          if (abs > peak) peak = abs;
        }
        setAudioLevel(peak);

        if (modeRef.current === null) {
          detector.feed(chunk);
          const hit = detector.scan();
          if (hit) {
            modeRef.current = { ...hit.mode, vis: null };
            // Try to derive the VIS byte from the mode key -> table
            for (const [visStr, m] of Object.entries(MODES)) {
              if (m === hit.mode) modeRef.current.vis = `0x${Number(visStr).toString(16).padStart(2, '0').toUpperCase()}`;
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
      source.connect(processor);
      processor.connect(ctx.destination); // required for ScriptProcessorNode to fire
    } catch (exc) {
      console.error('[sstv] getUserMedia failed', exc);
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
  };
}
