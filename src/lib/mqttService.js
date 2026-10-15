// @ts-nocheck
// MQTT telemetry service for BACAR Skybridge 14 CUBEs.
// Connects to a broker over WebSocket when configured; otherwise runs a
// realistic stratospheric-balloon simulation so the UI is fully demonstrable.

import mqtt from 'mqtt';

export const MQTT_TOPICS = {
  luminaTelemetry: 'lumina/telemetry',
  aerolinkTelemetry: 'aerolink/telemetry',
  aprsTelemetry: 'aprs/telemetry',
  sondehubTelemetry: 'sondehub/telemetry',
  picoTelemetry: 'pico/telemetry',
  rotatorTelemetry: 'rotator/telemetry',
  sstvStatus: 'sstv/status',
  chat: 'lumina/chat',
  attendees: 'lumina/attendees',
};

const SSTV_HISTORY_MAX = 20;

// ---- Presence ----
const PRESENCE_SESSION_KEY     = 'bacar_presence_session_v1';
const PRESENCE_HISTORY_KEY     = 'bacar_presence_history_v1';
const PRESENCE_LAST_BACKUP_KEY = 'bacar_presence_last_backup_v1';
const PRESENCE_HEARTBEAT_MS    = 15_000;   // publish own presence every 15s
const PRESENCE_STALE_MS        = 60_000;   // consider a session gone after 60s
const PRESENCE_HISTORY_DAYS    = 5;        // keep 5 days of join events
const PRESENCE_BACKUP_INTERVAL = PRESENCE_HISTORY_DAYS * 24 * 3600 * 1000;

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
];

// Hardcoded APRS/SondeHub callsigns we always render a card for, in order.
// Any extra "zr6ljk-*" variant arriving on the feed also gets a card
// appended at the end — see trackCallsignTelemetry() for the match rule.
export const CALLSIGN_PREFIX = 'zr6ljk';
export const CALLSIGN_CARDS  = ['zr6ljk', 'zr6ljk-6'];
// User-added callsigns live in localStorage so each viewer's picks persist
// across reloads but aren't shared with other viewers (no server-side list).
export const USER_CALLSIGNS_KEY = 'bacar_user_callsigns_v1';

const BROKER_KEY = 'bacar_broker_url_v1';
const DEFAULT_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const HISTORY_MAX = 180; // ~15 min at 5s cadence
const NRF_IMAGE_SCHEMA = 'bacar.nrf.image.v1';

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @param {string[]} aliases
 * @returns {unknown}
 */
function findTelemetryValue(source, aliases) {
  if (!source || typeof source !== 'object') return undefined;
  const entries = Object.entries(source);
  const normalized = new Map(
    entries.map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value])
  );
  return aliases
    .map((alias) => normalized.get(alias.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .find((value) => value !== undefined && value !== null && value !== '');
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeBrokerUrl(url) {
  const trimmed = url.trim();
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    trimmed.startsWith('ws://')
  ) {
    return trimmed.replace(/^ws:\/\//, 'wss://').replace(':8083', ':8084');
  }
  return trimmed;
}

/**
 * @param {any} payload
 * @returns {Record<string, any> | null}
 */
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

  if (telemetry.latitude === undefined) {
    telemetry.latitude = asNumber(findTelemetryValue(nestedGps, ['lat', 'latitude']));
  }
  if (telemetry.longitude === undefined) {
    telemetry.longitude = asNumber(findTelemetryValue(nestedGps, ['lon', 'lng', 'longitude']));
  }
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
    // Legacy single-latest slots (preserved for anything still reading them).
    this.aprsTelemetry = null;
    this.sondehubTelemetry = null;
    // Per-callsign maps keyed by lowercase callsign — the dashboard renders
    // one card per callsign for feeds that carry traffic from multiple
    // stations.
    /** @type {Map<string, any>} */
    this.aprsByCallsign = new Map();
    /** @type {Map<string, any>} */
    this.sondehubByCallsign = new Map();
    this.picoTelemetry = null;
    this.rotatorTelemetry = null;
    /** @type {any} */
    this.sstvStatus = null;
    /** @type {Array<any>} */
    this.sstvHistory = [];
    /** @type {Set<Function>} */
    this.listeners = new Set();
    /** @type {Set<Function>} */
    this.alertListeners = new Set();
    /** @type {Array<any>} */
    this.alerts = [];
    /** @type {Record<string, number>} */
    this.lastAlertAt = {};
    /** @type {import('mqtt').MqttClient | null} */
    this.client = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.simTimer = null;
    this.simStartedAt = 0;
    this.mode = 'idle';
    // Last-received-message timestamp (any inbound topic). The UI reads this
    // to flag the feed as "stale" when nothing has come in for a while —
    // catches "broker is up / connection is live but no cubes are publishing"
    // which otherwise looks identical to a healthy feed.
    this.lastMessageAt = 0;
    this.messageCount = 0;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.refreshTimer = null;

    // ---- Presence (who's on the dashboard right now) ----
    // sessionId: unique per browser tab; survives reloads via sessionStorage.
    this.sessionId = this._loadSessionId();
    this.observerInfo = null;  // { name, callsign, location, lat, lon, type }
    /** @type {Map<string, any>} */
    this.presenceById = new Map(); // sessionId -> { sender, location, lat, lon, lastSeen, joinedAt }
    /** @type {Array<any>} */
    this.presenceHistory = this._loadPresenceHistory(); // 5-day rolling log
    /** @type {ReturnType<typeof setInterval> | null} */
    this.presenceTimer = null;
    this.lastBackupAt = Number(localStorage.getItem(PRESENCE_LAST_BACKUP_KEY) || '0');
    const savedBrokerUrl = localStorage.getItem(BROKER_KEY);
    this.brokerUrl = normalizeBrokerUrl(
      savedBrokerUrl === null ? DEFAULT_BROKER_URL : savedBrokerUrl
    );
    if (savedBrokerUrl !== this.brokerUrl) localStorage.setItem(BROKER_KEY, this.brokerUrl);
  }

  getAlerts() {
    return this.alerts;
  }

  /**
   * @param {Function} listener
   * @returns {() => void}
   */
  subscribeAlerts(listener) {
    this.alertListeners.add(listener);
    listener(this.alerts);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  /**
   * @param {string} id
   */
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

  /**
   * @param {any} cube
   * @param {string} type
   * @param {string} message
   */
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

  /**
   * Detect burst (ascent -> descent transition) and sustained rapid descent.
   * @param {any} cube
   * @param {any} prev
   * @param {any} point
   */
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

  getBrokerUrl() {
    return this.brokerUrl;
  }

  /**
   * @param {string} url
   */
  setBrokerUrl(url) {
    this.brokerUrl = normalizeBrokerUrl(url);
    localStorage.setItem(BROKER_KEY, this.brokerUrl);
  }

  getCubes() {
    return this.cubes;
  }

  getAprsTelemetry() {
    return this.aprsTelemetry;
  }

  getSondehubTelemetry() {
    return this.sondehubTelemetry;
  }

  /** Snapshot of the per-callsign map as a plain object keyed by lowercase callsign. */
  getAprsByCallsign() {
    const out = {};
    for (const [k, v] of this.aprsByCallsign) out[k] = v;
    return out;
  }

  getSondehubByCallsign() {
    const out = {};
    for (const [k, v] of this.sondehubByCallsign) out[k] = v;
    return out;
  }

  /**
   * Merge a batch of SondeHub frames (from the public amateur API) into
   * the by-callsign map. Only replaces when the new frame is newer than
   * what we already have, so the live MQTT path and the HTTP poll path
   * can coexist without flipping backward.
   * @param {Record<string, any>} entries  Keyed by lowercase callsign.
   */
  mergeSondehubFrames(entries) {
    if (!entries || typeof entries !== 'object') return;
    let changed = false;
    for (const [cs, frame] of Object.entries(entries)) {
      if (!frame) continue;
      const existing = this.sondehubByCallsign.get(cs);
      if (existing && (frame.t || 0) <= (existing.t || 0)) continue;
      this.sondehubByCallsign.set(cs, frame);
      this.sondehubTelemetry = frame;
      changed = true;
    }
    if (changed) this._emit();
  }

  getPicoTelemetry() {
    return this.picoTelemetry;
  }

  getRotatorTelemetry() {
    return this.rotatorTelemetry;
  }

  getSstvStatus() {
    return this.sstvStatus;
  }

  getSstvHistory() {
    return this.sstvHistory;
  }

  getLastMessageAt() {
    return this.lastMessageAt;
  }

  getMessageCount() {
    return this.messageCount;
  }

  // ============================================================
  // PRESENCE API
  // ============================================================
  _loadSessionId() {
    try {
      let id = sessionStorage.getItem(PRESENCE_SESSION_KEY);
      if (!id) {
        id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(PRESENCE_SESSION_KEY, id);
      }
      return id;
    } catch {
      return `anon-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  _loadPresenceHistory() {
    try {
      const raw = localStorage.getItem(PRESENCE_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Prune older than PRESENCE_HISTORY_DAYS on load.
      const cutoff = Date.now() - PRESENCE_HISTORY_DAYS * 24 * 3600 * 1000;
      return parsed.filter((e) => (e?.t || 0) > cutoff);
    } catch {
      return [];
    }
  }

  _savePresenceHistory() {
    try {
      localStorage.setItem(PRESENCE_HISTORY_KEY, JSON.stringify(this.presenceHistory));
    } catch { /* storage disabled */ }
  }

  /**
   * Register this viewer's identity. Called once from the top-level app
   * once the observer has identified. Triggers the first presence publish
   * if the MQTT client is already connected.
   * @param {{name?: string, callsign?: string, location?: string, lat?: number, lon?: number, type?: string}} info
   */
  setObserverIdentity(info) {
    this.observerInfo = info || null;
    if (this.client?.connected) this._publishPresence('online');
  }

  _publishPresence(status) {
    if (!this.client?.connected) return;
    const payload = {
      type:       'presence',
      status,
      sender:     this.observerInfo?.callsign || this.observerInfo?.name || 'Guest',
      session_id: this.sessionId,
      location:   this.observerInfo?.location || null,
      lat:        this.observerInfo?.lat ?? null,
      lon:        this.observerInfo?.lon ?? null,
      kind:       this.observerInfo?.type || 'guest',
      t:          Date.now(),
    };
    try {
      this.client.publish(MQTT_TOPICS.attendees, JSON.stringify(payload), { qos: 0 });
    } catch { /* ignore publish errors */ }
  }

  _handlePresenceMessage(payload) {
    try {
      const msg = JSON.parse(payload.toString());
      if (!msg || msg.type !== 'presence' || !msg.session_id) return;
      const key = String(msg.session_id);
      if (msg.status === 'offline') {
        this.presenceById.delete(key);
      } else {
        const existing = this.presenceById.get(key);
        this.presenceById.set(key, {
          sessionId: key,
          sender:    msg.sender || 'Guest',
          location:  msg.location || null,
          lat:       Number.isFinite(msg.lat) ? msg.lat : null,
          lon:       Number.isFinite(msg.lon) ? msg.lon : null,
          kind:      msg.kind || 'guest',
          joinedAt:  existing?.joinedAt || msg.t || Date.now(),
          lastSeen:  msg.t || Date.now(),
        });
        if (!existing) {
          // New join → record in rolling history.
          this.presenceHistory.push({
            t:         msg.t || Date.now(),
            sessionId: key,
            sender:    msg.sender || 'Guest',
            location:  msg.location || null,
            lat:       Number.isFinite(msg.lat) ? msg.lat : null,
            lon:       Number.isFinite(msg.lon) ? msg.lon : null,
            kind:      msg.kind || 'guest',
          });
          this._pruneHistory();
          this._savePresenceHistory();
          this._maybeAutoBackup();
        }
      }
      this._emit();
    } catch { /* ignore malformed presence messages */ }
  }

  _pruneStalePresence() {
    const cutoff = Date.now() - PRESENCE_STALE_MS;
    let changed = false;
    for (const [k, v] of this.presenceById) {
      if (v.lastSeen < cutoff) {
        this.presenceById.delete(k);
        changed = true;
      }
    }
    if (changed) this._emit();
  }

  _pruneHistory() {
    const cutoff = Date.now() - PRESENCE_HISTORY_DAYS * 24 * 3600 * 1000;
    this.presenceHistory = this.presenceHistory.filter((e) => (e?.t || 0) > cutoff);
  }

  _maybeAutoBackup() {
    const now = Date.now();
    // First-ever run: seed the timestamp and bail. Otherwise the very first
    // join triggers an "it's been forever since the last backup" download,
    // which is noise — the backup is for actual 5-day cycles.
    if (this.lastBackupAt === 0) {
      this.lastBackupAt = now;
      try { localStorage.setItem(PRESENCE_LAST_BACKUP_KEY, String(now)); } catch { /* ignore */ }
      return;
    }
    if (now - this.lastBackupAt < PRESENCE_BACKUP_INTERVAL) return;
    if (this.presenceHistory.length === 0) return;
    // Also require at least one entry older than the backup interval, so a
    // 5-day-old session that just joined doesn't trigger an export of only
    // the newest row.
    const oldest = this.presenceHistory.reduce((min, e) => Math.min(min, e?.t || now), now);
    if (now - oldest < PRESENCE_BACKUP_INTERVAL) return;
    this.lastBackupAt = now;
    try {
      localStorage.setItem(PRESENCE_LAST_BACKUP_KEY, String(now));
    } catch { /* ignore */ }
    this.downloadPresenceBackup(`skybridge14_presence_auto_${new Date(now).toISOString().slice(0, 10)}.json`);
  }

  /** Returns snapshot array of currently-online users (newest first). */
  getPresence() {
    this._pruneStalePresence();
    return Array.from(this.presenceById.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** Returns the 5-day rolling join log (newest first). */
  getPresenceHistory() {
    this._pruneHistory();
    return [...this.presenceHistory].sort((a, b) => b.t - a.t);
  }

  /** Trigger a browser download of the presence history as JSON. */
  downloadPresenceBackup(filename = `skybridge14_presence_${Date.now()}.json`) {
    if (typeof document === 'undefined') return;
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), days: PRESENCE_HISTORY_DAYS, entries: this.presenceHistory }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Broadcast an SSTV capture to every other viewer. Called by the in-browser
   * receiver when it locks on and decodes a frame. Silent no-op when the MQTT
   * client isn't connected — a local capture is still visible to the operator
   * who ran it; sharing is best-effort.
   */
  publishSstvCapture(payload) {
    if (!this.client || !this.client.connected) return false;
    try {
      const msg = { ...payload, t: payload.t || Date.now(), source: 'browser' };
      this.client.publish(MQTT_TOPICS.sstvStatus, JSON.stringify(msg), { qos: 0 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {Function} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.cubes);
    return () => {
      this.listeners.delete(listener);
    };
  }

  _emit() {
    // emit a shallow-copied array so React state setters see a new reference
    const snapshot = [...this.cubes];
    this.listeners.forEach((l) => l(snapshot));
  }

  /**
   * @param {string} cubeId
   * @param {any} data
   */
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

  /**
   * @param {string} cubeId
   * @param {string} imageUrl
   */
  _applyImage(cubeId, imageUrl) {
    const cube = this.cubes.find((c) => c.id === cubeId);
    if (!cube) return;
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) return;
    cube.images = [{ url: imageUrl, t: Date.now() }, ...cube.images].slice(0, 24);
    this._emit();
  }

  /**
   * @param {string} cubeId
   * @param {any} payloadText
   * @returns {string | null}
   */
  _parseNrfImagePayload(cubeId, payloadText) {
    const raw = payloadText?.toString?.() ?? '';
    if (!raw.trim()) return null;

    try {
      const parsed = JSON.parse(raw);
      const imageObj = parsed?.image || parsed;

      if (
        parsed?.schema === NRF_IMAGE_SCHEMA ||
        parsed?.type === 'nrf_image' ||
        parsed?.cube_id === cubeId
      ) {
        if (typeof imageObj?.url === 'string' && imageObj.url.trim()) return imageObj.url;
        if (typeof imageObj?.data === 'string' && imageObj.data.trim()) {
          return imageObj.data.startsWith('data:')
            ? imageObj.data
            : `data:${imageObj.mime_type || 'image/jpeg'};base64,${imageObj.data}`;
        }
        if (typeof parsed?.image_url === 'string' && parsed.image_url.trim()) {
          return parsed.image_url;
        }
        if (typeof parsed?.image_data === 'string' && parsed.image_data.trim()) {
          return parsed.image_data.startsWith('data:')
            ? parsed.image_data
            : `data:${parsed.mime_type || 'image/jpeg'};base64,${parsed.image_data}`;
        }
      }
    } catch {
      // fall through to raw-string handling below
    }

    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) {
      return raw;
    }
    if (raw.startsWith('{') || raw.startsWith('[')) return null;
    if (raw.length > 0) return raw;
    return null;
  }

  /**
   * @param {string} [brokerUrl]
   */
  connect(brokerUrl) {
    if (typeof brokerUrl === 'string') {
      this.setBrokerUrl(brokerUrl);
    }
    const url = this.brokerUrl;
    this.disconnect();
    if (!url) {
      // No broker URL configured. Sit idle rather than fabricating data —
      // simulation is intentionally NOT a fallback for a missing/offline
      // broker so operators aren't misled into thinking they have telemetry.
      this.mode = 'idle';
      this._emit();
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
        MQTT_TOPICS.rotatorTelemetry,
        MQTT_TOPICS.sstvStatus,
        MQTT_TOPICS.attendees,
      );
      this.client.subscribe(topics, (err) => {
        if (err) {
          this.mode = 'idle';
        }
      });
      // Announce own presence immediately on connect, then start heartbeat.
      this._publishPresence('online');
      if (this.presenceTimer) clearInterval(this.presenceTimer);
      this.presenceTimer = setInterval(() => {
        this._publishPresence('online');
        this._pruneStalePresence();
      }, PRESENCE_HEARTBEAT_MS);
    });
    this.client.on('message', (topic, payload) => {
      this.lastMessageAt = Date.now();
      this.messageCount++;
      if (topic === MQTT_TOPICS.aprsTelemetry) {
        try {
          const t = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this.aprsTelemetry = t;
          if (t?.callsign) {
            this.aprsByCallsign.set(String(t.callsign).toLowerCase(), t);
          }
          this._emit();
        } catch {
          /* ignore malformed APRS payloads */
        }
        return;
      }
      if (topic === MQTT_TOPICS.sondehubTelemetry) {
        try {
          const t = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this.sondehubTelemetry = t;
          if (t?.callsign) {
            this.sondehubByCallsign.set(String(t.callsign).toLowerCase(), t);
          }
          this._emit();
        } catch {
          /* ignore malformed SondeHub payloads */
        }
        return;
      }
      if (topic === MQTT_TOPICS.picoTelemetry) {
        try {
          this.picoTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch {
          /* ignore malformed Pico Balloon payloads */
        }
        return;
      }
      if (topic === MQTT_TOPICS.rotatorTelemetry) {
        try {
          this.rotatorTelemetry = normalizeTelemetryPayload(JSON.parse(payload.toString()));
          this._emit();
        } catch {
          /* ignore malformed rotator payloads */
        }
        return;
      }
      if (topic === MQTT_TOPICS.attendees) {
        this._handlePresenceMessage(payload);
        return;
      }
      if (topic === MQTT_TOPICS.sstvStatus) {
        try {
          const status = JSON.parse(payload.toString());
          if (status && typeof status === 'object') {
            const stamped = { ...status, t: status.t || Date.now() };
            this.sstvStatus = stamped;
            // Keep a rolling window of recent bridge events so the SSTV
            // tab can show what's been transmitted lately.
            // Both the encoder ('encoded') and the receiver ('captured') push
            // event rows the SSTV tab renders in its Recent list.
            const isRow = ['encoded', 'captured'].includes(stamped.event) ||
                          ['encoded', 'captured'].includes(stamped.status);
            if (isRow) {
              this.sstvHistory = [stamped, ...this.sstvHistory].slice(0, SSTV_HISTORY_MAX);
            }
            this._emit();
          }
        } catch {
          /* ignore malformed SSTV bridge payloads */
        }
        return;
      }
      const cube = this.cubes.find(
        (c) => topic === c.telemetryTopic || topic.startsWith(c.baseTopic)
      );
      if (!cube) return;
      const kind =
        topic.startsWith(cube.baseTopic) && topic.endsWith('/image') ? 'image' : 'telemetry';
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
        } catch {
          /* ignore malformed */
        }
      }
    });
    this.client.on('error', () => {});

    // Public 5-second refresh — every connected viewer re-emits even when no
    // new MQTT message arrived. Keeps "updated Xs ago" counters consistent
    // across devices and refreshes any time-based derivations in the UI.
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this._emit(), 5000);
    this.client.on('offline', () => {});
  }

  disconnect() {
    if (this.client) {
      try {
        // Announce leave before closing so other viewers' counters drop immediately.
        this._publishPresence('offline');
      } catch { /* ignore */ }
      try {
        this.client.end(true);
      } catch {}
      this.client = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
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
        const verticalSpeed =
          elapsedSecs < 45
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
          state_of_charge_pct: 92 - elapsedSecs * 0.18,
          total_distance_km: Math.max(0, elapsedSecs - 8) * 0.28 + index * 0.2,
          horizontal_distance_km: Math.max(0, elapsedSecs * 0.18) + index * 0.1,
          booster_voltage_v: 7.5 + Math.sin(elapsedSecs / 10 + index) * 0.4,
          payload_health: 98 - elapsedSecs * 0.09,
          mode: cube.mode,
          source: 'simulation',
        };

        this._applyTelemetry(cube.id, point);
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

  isSim() {
    return this.mode === 'sim';
  }

  isLive() {
    return this.mode === 'mqtt';
  }
}

export const telemetry = new TelemetryService();