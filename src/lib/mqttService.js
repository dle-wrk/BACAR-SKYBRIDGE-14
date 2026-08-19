// MQTT telemetry service for BACAR Skybridge 14 CUBEs.
// Connects to a broker over WebSocket when configured; otherwise runs a
// realistic stratospheric-balloon simulation so the UI is fully demonstrable.

import mqtt from 'mqtt';

const CUBE_CONFIGS = [
  {
    id: 'BACAR-14A',
    name: 'Project LuminoStratos',
    baseTopic: 'bacar/skybridge14/cubeA',
    mode: 'full_telemetry',
    cameraConfig: {
      count: 2,
      imageCounter: 14,
      videoCounter: 6,
    },
    profile: {
      startAlt: 1637,
      startVel: 5.5,
      startLat: -26.484693289862868,
      startLon: 29.22040967145355,
      burstAlt: 34200,
      driftLat: 0.00009,
      driftLon: 0.00006,
      tempOffset: 0,
    },
  },
  {
    id: 'BACAR-14B',
    name: 'Project AreoLink',
    baseTopic: 'bacar/skybridge14/cubeB',
    mode: 'radio_battery_only',
    profile: {
      startAlt: 1637,
      startVel: 5.2,
      startLat: -26.484693289862868,
      startLon: 29.22040967145355,
      burstAlt: 34850,
      driftLat: 0.00011,
      driftLon: 0.00008,
      tempOffset: -1.2,
    },
  },
  {
    id: 'BACAR-14C',
    name: 'Project HoloCube',
    baseTopic: 'bacar/skybridge14/cubeC',
    mode: 'nrf_image_only',
    profile: {
      startAlt: 1637,
      startVel: 6.1,
      startLat: -26.484693289862868,
      startLon: 29.22040967145355,
      burstAlt: 33800,
      driftLat: 0.00010,
      driftLon: 0.00007,
      tempOffset: 1.4,
    },
  },
];

const BROKER_KEY = 'bacar_broker_url_v1';
const HISTORY_MAX = 180; // ~15 min at 5s cadence
const BACAR_14C_NRF_IMAGE_SCHEMA = 'bacar.nrf.image.v1';

class TelemetryService {
  constructor() {
    this.cubes = CUBE_CONFIGS.map((c) => ({
      ...c,
      mode: c.mode || 'full_telemetry',
      cameraConfig: c.cameraConfig || { count: 0, imageCounter: 0, videoCounter: 0 },
      profile: { ...c.profile },
      telemetry: null,
      history: [],
      images: [],
    }));
    this.listeners = new Set();
    this.alertListeners = new Set();
    this.alerts = [];
    this.lastAlertAt = {}; // `${cubeId}:${type}` -> timestamp, for cooldown
    this.client = null;
    this.mode = 'idle';
    this.brokerUrl = localStorage.getItem(BROKER_KEY) || '';
  }

  getAlerts() { return this.alerts; }

  subscribeAlerts(listener) {
    this.alertListeners.add(listener);
    listener(this.alerts);
    return () => this.alertListeners.delete(listener);
  }

  dismissAlert(id) {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    this._emitAlerts();
  }

  clearAlerts() {
    this.alerts = [];
    this._emitAlerts();
  }

  _emitAlerts() {
    const snap = [...this.alerts];
    this.alertListeners.forEach((l) => l(snap));
  }

  _pushAlert(cube, type, message) {
    const key = `${cube.id}:${type}`;
    const now = Date.now();
    if (this.lastAlertAt[key] && now - this.lastAlertAt[key] < 60000) return; // 60s cooldown
    this.lastAlertAt[key] = now;
    const t = cube.telemetry || {};
    const alert = {
      id: `${cube.id}-${type}-${now}`,
      cube_id: cube.id,
      cube_name: cube.name,
      type, // 'burst' | 'rapid_descent'
      message,
      altitude_m: t.altitude_m,
      vertical_speed_ms: t.vertical_speed_ms,
      t: now,
    };
    this.alerts = [alert, ...this.alerts].slice(0, 50);
    this._emitAlerts();
  }

  // Detect burst (ascent -> descent transition) and sustained rapid descent.
  _detectBurst(cube, prev, point) {
    if (!prev || point.vertical_speed_ms == null || prev.vertical_speed_ms == null) return;
    const prevClimbing = prev.vertical_speed_ms > 0.5;
    const nowFalling = point.vertical_speed_ms < -1;
    // Burst: was climbing, now falling — the envelope has ruptured.
    if (prevClimbing && nowFalling) {
      this._pushAlert(
        cube,
        'burst',
        `Balloon burst detected at ${(point.altitude_m / 1000).toFixed(2)} km — now descending at ${point.vertical_speed_ms} m/s.`
      );
      return;
    }
    // Sustained rapid descent (freefall before parachute / fast drop).
    if (point.vertical_speed_ms < -8) {
      this._pushAlert(
        cube,
        'rapid_descent',
        `Rapid descent: ${point.vertical_speed_ms} m/s at ${(point.altitude_m / 1000).toFixed(2)} km.`
      );
    }
  }

  getBrokerUrl() { return this.brokerUrl; }

  setBrokerUrl(url) {
    this.brokerUrl = url.trim();
    localStorage.setItem(BROKER_KEY, this.brokerUrl);
  }

  getCubes() { return this.cubes; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.cubes);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    // emit a shallow-copied array so React state setters see a new reference
    const snapshot = [...this.cubes];
    this.listeners.forEach((l) => l(snapshot));
  }

  _applyTelemetry(cubeId, data) {
    const cube = this.cubes.find((c) => c.id === cubeId);
    if (!cube) return;
    const prev = cube.telemetry;
    const point = { ...data, t: data.t || Date.now() };
    cube.telemetry = point;
    cube.history = [...cube.history, point].slice(-HISTORY_MAX);
    this._detectBurst(cube, prev, point);
    this._emit();
  }

  _applyImage(cubeId, imageUrl) {
    const cube = this.cubes.find((c) => c.id === cubeId);
    if (!cube) return;
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) return;
    cube.images = [{ url: imageUrl, t: Date.now() }, ...cube.images].slice(0, 24);
    this._emit();
  }

  _parseNrfImagePayload(cubeId, payloadText) {
    const raw = payloadText?.toString?.() ?? '';
    if (!raw.trim()) return null;

    try {
      const parsed = JSON.parse(raw);
      const imageObj = parsed?.image || parsed;

      if (parsed?.schema === BACAR_14C_NRF_IMAGE_SCHEMA || parsed?.type === 'nrf_image' || parsed?.cube_id === cubeId) {
        if (typeof imageObj?.url === 'string' && imageObj.url.trim()) return imageObj.url;
        if (typeof imageObj?.data === 'string' && imageObj.data.trim()) return imageObj.data.startsWith('data:') ? imageObj.data : `data:${imageObj.mime_type || 'image/jpeg'};base64,${imageObj.data}`;
        if (typeof parsed?.image_url === 'string' && parsed.image_url.trim()) return parsed.image_url;
        if (typeof parsed?.image_data === 'string' && parsed.image_data.trim()) return parsed.image_data.startsWith('data:') ? parsed.image_data : `data:${parsed.mime_type || 'image/jpeg'};base64,${parsed.image_data}`;
      }
    } catch {
      // fall through to raw-string handling below
    }

    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw;
    if (raw.startsWith('{') || raw.startsWith('[')) return null;
    if (raw.length > 0) return raw;
    return null;
  }

  connect(brokerUrl) {
    if (brokerUrl) this.setBrokerUrl(brokerUrl);
    const url = this.brokerUrl;
    this.disconnect();
    if (!url) {
      this.mode = 'idle';
      return;
    }
    this.mode = 'mqtt';
    try {
      this.client = mqtt.connect(url, {
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        clean: true,
      });
    } catch (e) {
      this.mode = 'idle';
      return;
    }
    this.client.on('connect', () => {
      const topics = [];
      this.cubes.forEach((c) => {
        topics.push(`${c.baseTopic}/telemetry`);
        topics.push(`${c.baseTopic}/image`);
      });
      this.client.subscribe(topics, (err) => {
        if (err) {
          this.mode = 'idle';
        }
      });
    });
    this.client.on('message', (topic, payload) => {
      const cube = this.cubes.find((c) => topic.startsWith(c.baseTopic));
      if (!cube) return;
      const kind = topic.endsWith('/image') ? 'image' : 'telemetry';
      if (kind === 'image') {
        const parsedUrl = this._parseNrfImagePayload(cube.id, payload);
        if (parsedUrl) {
          this._applyImage(cube.id, parsedUrl);
        }
      } else {
        try {
          const data = JSON.parse(payload.toString());
          if (data.cube_id) data.id = data.cube_id;
          this._applyTelemetry(cube.id, data);
        } catch { /* ignore malformed */ }
      }
    });
    this.client.on('error', () => {});
    this.client.on('offline', () => {});
  }

  disconnect() {
    if (this.client) {
      try { this.client.end(true); } catch {}
      this.client = null;
    }
    this.mode = 'idle';
  }

  _startSim() {
    this.mode = 'idle';
  }

  _stopSim() {
    this.mode = 'idle';
  }

  isSim() { return false; }
  isLive() { return this.mode === 'mqtt'; }
}

export const telemetry = new TelemetryService();