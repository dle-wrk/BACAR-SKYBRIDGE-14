// MQTT telemetry service for BACAR Skybridge 14 CUBEs.
// Connects to a broker over WebSocket when configured; otherwise runs a
// realistic stratospheric-balloon simulation so the UI is fully demonstrable.

import mqtt from 'mqtt';

export const MQTT_TOPICS = {
  luminaTelemetry: 'lumina/telemetry',
  aerolinkTelemetry: 'aerolink/telemetry',
  holocubeTelemetry: 'holocube/telemetry',
  aprsTelemetry: 'aprs/telemetry',
  sondehubTelemetry: 'sondehub/telemetry',
  picoTelemetry: 'pico/telemetry',
  rotatorTelemetry: 'rotator/telemetry',
  chat: 'lumina/chat',
  attendees: 'lumina/attendees',
};

const CUBE_CONFIGS = [
  {
    id: 'BACAR-14A',
    name: 'Project LuminoStratos',
    baseTopic: 'bacar/skybridge14/cubeA',
    telemetryTopic: MQTT_TOPICS.luminaTelemetry,
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
    telemetryTopic: MQTT_TOPICS.aerolinkTelemetry,
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
    telemetryTopic: MQTT_TOPICS.holocubeTelemetry,
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
const DEFAULT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const HISTORY_MAX = 180; // ~15 min at 5s cadence
const BACAR_14C_NRF_IMAGE_SCHEMA = 'bacar.nrf.image.v1';

function findTelemetryValue(source, aliases) {
  if (!source || typeof source !== 'object') return undefined;
  const entries = Object.entries(source);
  const normalized = new Map(entries.map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value]));
  return aliases
    .map((alias) => normalized.get(alias.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .find((value) => value !== undefined && value !== null && value !== '');
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeBrokerUrl(url) {
  const trimmed = url.trim();
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && trimmed.startsWith('ws://')) {
    return trimmed.replace(/^ws:\/\//, 'wss://').replace(':8083', ':8084');
  }
  return trimmed;
}

function normalizeTelemetryPayload(payload) {
  const source = payload?.telemetry || payload?.data || payload?.payload || payload;
  if (!source || typeof source !== 'object') return null;

  const read = (aliases) => findTelemetryValue(source, aliases);
  const nestedGps = source.gps && typeof source.gps === 'object' ? source.gps : {};
  const telemetry = { ...source };
  const setNumber = (key, aliases) => {
    const value = asNumber(read(aliases));
    if (value !== undefined) telemetry[key] = value;
  };

  setNumber('altitude_m', ['altitude_m', 'altitude', 'altitude_meters', 'altitudeMeters']);
  setNumber('temperature_c', ['temperature_c', 'temperature', 'temp_c', 'temp']);
  setNumber('pressure_hpa', ['pressure_hpa', 'pressure', 'air_pressure_hpa', 'barometric_pressure']);
  setNumber('battery_v', ['battery_v', 'battery_voltage', 'battery_voltage_v', 'voltage', 'batteryVoltage']);
  setNumber('battery_current_ma', ['battery_current_ma', 'current_ma', 'current_draw_ma', 'current_draw', 'currentDraw']);
  setNumber('latitude', ['latitude', 'lat', 'gps_lat', 'gps_latitude', 'gpsLat']);
  setNumber('longitude', ['longitude', 'lon', 'lng', 'gps_lon', 'gps_longitude', 'gpsLon']);
  setNumber('vertical_speed_ms', ['vertical_speed_ms', 'vertical_speed', 'climb_rate', 'climbRate']);
  setNumber('speed_ms', ['speed_ms', 'speed', 'ground_speed', 'groundSpeed']);
  setNumber('heading_deg', ['heading_deg', 'heading', 'course', 'bearing']);
  setNumber('vhf_frequency', ['vhf_frequency', 'vhf_freq', 'vhfFrequency']);
  setNumber('uhf_frequency', ['uhf_frequency', 'uhf_freq', 'uhfFrequency']);
  setNumber('vhf_power', ['vhf_power', 'vhf_tx_power', 'vhfPower']);
  setNumber('uhf_power', ['uhf_power', 'uhf_tx_power', 'uhfPower']);
  setNumber('aprs_speed', ['aprs_speed', 'speed', 'speed_kmh', 'speed_knots']);
  setNumber('aprs_course', ['aprs_course', 'course', 'heading', 'bearing']);
  setNumber('frequency', ['frequency', 'freq', 'radio_frequency', 'radioFrequency']);
  setNumber('horizontal_angle', ['horizontal_angle', 'azimuth', 'azimuth_deg', 'pan', 'pan_deg']);
  setNumber('vertical_angle', ['vertical_angle', 'elevation', 'elevation_deg', 'tilt', 'tilt_deg']);

  if (telemetry.latitude === undefined) telemetry.latitude = asNumber(findTelemetryValue(nestedGps, ['lat', 'latitude']));
  if (telemetry.longitude === undefined) telemetry.longitude = asNumber(findTelemetryValue(nestedGps, ['lon', 'lng', 'longitude']));
  telemetry.callsign = read(['callsign', 'call_sign', 'station', 'station_id']);
  telemetry.uploader = read(['uploader', 'uploaded_by', 'receiver', 'uploader_callsign']);
  telemetry.symbol = read(['symbol', 'symbol_code', 'symbol_table']);
  telemetry.comment = read(['comment', 'message', 'status_text']);
  telemetry.tracking_mode = read(['tracking_mode', 'tracking', 'track_mode', 'mode']);
  telemetry.status = read(['status', 'state', 'mission_status', 'flight_status']);
  telemetry.errors = read(['errors', 'error', 'faults', 'warnings']);
  telemetry.t = asNumber(read(['t', 'time', 'timestamp', 'timestamp_ms'])) || Date.now();
  return telemetry;
}

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
    this.aprsTelemetry = null;
    this.sondehubTelemetry = null;
    this.picoTelemetry = null;
    this.rotatorTelemetry = null;
    this.listeners = new Set();
    this.alertListeners = new Set();
    this.alerts = [];
    this.lastAlertAt = {}; // `${cubeId}:${type}` -> timestamp, for cooldown
    this.client = null;
    this.simTimer = null;
    this.simStartedAt = 0;
    this.mode = 'idle';
    const savedBrokerUrl = localStorage.getItem(BROKER_KEY);
    this.brokerUrl = normalizeBrokerUrl(savedBrokerUrl === null ? DEFAULT_BROKER_URL : savedBrokerUrl);
    if (savedBrokerUrl !== this.brokerUrl) localStorage.setItem(BROKER_KEY, this.brokerUrl);
  }

  getAlerts() { return this.alerts; }

  subscribeAlerts(listener) {
    this.alertListeners.add(listener);
    listener(this.alerts);
    return () => { this.alertListeners.delete(listener); };
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
    this.brokerUrl = normalizeBrokerUrl(url);
    localStorage.setItem(BROKER_KEY, this.brokerUrl);
  }

  getCubes() { return this.cubes; }

  getAprsTelemetry() { return this.aprsTelemetry; }

  getSondehubTelemetry() { return this.sondehubTelemetry; }

  getPicoTelemetry() { return this.picoTelemetry; }

  getRotatorTelemetry() { return this.rotatorTelemetry; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.cubes);
    return () => { this.listeners.delete(listener); };
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
    if (typeof brokerUrl === 'string') {
      this.setBrokerUrl(brokerUrl);
    }
    const url = this.brokerUrl;
    this.disconnect();
    if (!url) {
      this._startSim();
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
        topics.push(c.telemetryTopic);
        topics.push(`${c.baseTopic}/image`);
      });
      topics.push(
        MQTT_TOPICS.aprsTelemetry,
        MQTT_TOPICS.sondehubTelemetry,
        MQTT_TOPICS.picoTelemetry,
        MQTT_TOPICS.rotatorTelemetry
      );
      this.client.subscribe(topics, (err) => {
        if (err) {
          this.mode = 'idle';
        }
      });
    });
    this.client.on('message', (topic, payload) => {
      if (topic === MQTT_TOPICS.aprsTelemetry) {
        try {
          this.aprsTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch { /* ignore malformed APRS payloads */ }
        return;
      }
      if (topic === MQTT_TOPICS.sondehubTelemetry) {
        try {
          this.sondehubTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch { /* ignore malformed SondeHub payloads */ }
        return;
      }
      if (topic === MQTT_TOPICS.picoTelemetry) {
        try {
          this.picoTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch { /* ignore malformed Pico Balloon payloads */ }
        return;
      }
      if (topic === MQTT_TOPICS.rotatorTelemetry) {
        try {
          this.rotatorTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch { /* ignore malformed rotator payloads */ }
        return;
      }
      const cube = this.cubes.find((c) => topic === c.telemetryTopic || topic.startsWith(c.baseTopic));
      if (!cube) return;
      const kind = topic.startsWith(cube.baseTopic) && topic.endsWith('/image') ? 'image' : 'telemetry';
      if (kind === 'image') {
        const parsedUrl = this._parseNrfImagePayload(cube.id, payload);
        if (parsedUrl) {
          this._applyImage(cube.id, parsedUrl);
        }
      } else {
        try {
          const data = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          if (!data) return;
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
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    this.mode = 'idle';
  }

  _startSim() {
    this.disconnect();
    this.mode = 'sim';
    this.simStartedAt = Date.now();
    this._emit();

    this.simTimer = setInterval(() => {
      const now = Date.now();
      const elapsedSecs = (now - this.simStartedAt) / 1000;

      this.cubes.forEach((cube, index) => {
        const profile = cube.profile;
        const climbProgress = Math.min(1, elapsedSecs / 48);
        const altitudeBoost = (profile.burstAlt - profile.startAlt) * climbProgress;
        const altitude = profile.startAlt + altitudeBoost + Math.sin(elapsedSecs / 7 + index) * 120;
        const verticalSpeed = elapsedSecs < 45
          ? profile.startVel * 4.5 + Math.sin(elapsedSecs / 5 + index) * 0.9
          : -Math.abs(Math.sin(elapsedSecs / 6 + index)) * 8 - 4.5;

        const latitude = profile.startLat + Math.sin(elapsedSecs / 12 + index) * 0.00018;
        const longitude = profile.startLon + Math.cos(elapsedSecs / 14 + index) * 0.00022;
        const temperature = profile.tempOffset + Math.sin(elapsedSecs / 9 + index) * 2.5;

        const point = {
          id: cube.id,
          cube_id: cube.id,
          t: now,
          altitude_m: Math.max(1200, altitude),
          vertical_speed_ms: verticalSpeed,
          latitude,
          longitude,
          gps_lat: latitude,
          gps_lon: longitude,
          temperature_c: temperature,
          pressure_hpa: 62 + Math.sin(elapsedSecs / 10 + index) * 8,
          battery_voltage_v: 3.9 + Math.sin(elapsedSecs / 11 + index) * 0.12,
          current_ma: 120 + Math.cos(elapsedSecs / 9 + index) * 25,
          signal_rssi_dbm: -82 + Math.sin(elapsedSecs / 8 + index) * 12,
          state_of_charge_pct: 92 - (elapsedSecs * 0.18),
          total_distance_km: (Math.max(0, elapsedSecs - 8) * 0.28) + index * 0.2,
          horizontal_distance_km: Math.max(0, (elapsedSecs * 0.18) + index * 0.1),
          booster_voltage_v: 7.5 + Math.sin(elapsedSecs / 10 + index) * 0.4,
          payload_health: 98 - (elapsedSecs * 0.09),
          mode: cube.mode,
          source: 'simulation',
        };

        this._applyTelemetry(cube.id, point);

        if (cube.mode === 'nrf_image_only' && elapsedSecs % 9 < 0.5) {
          const generated = `https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=800&q=80&sig=${(index + 1) * 7 + Math.floor(elapsedSecs)}`;
          this._applyImage(cube.id, generated);
        }
      });
    }, 2500);
  }

  _stopSim() {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    this.mode = 'idle';
  }

  isSim() { return this.mode === 'sim'; }
  isLive() { return this.mode === 'mqtt'; }
}

export const telemetry = new TelemetryService();