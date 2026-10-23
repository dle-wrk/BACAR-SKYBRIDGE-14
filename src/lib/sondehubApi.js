// Thin client for the SondeHub Amateur telemetry API.
//
// The API is public, CORS-enabled, and used by the official tracker at
// amateur.sondehub.org (projecthorus/sondehub-amateur-tracker, MIT).
//
// Response shape (top-level keyed by callsign, inner keyed by ISO ts):
//   {
//     "ZR6LJK-6": {
//       "2026-10-15T11:46:26.000Z": {
//         payload_callsign, datetime, lat, lon, alt, comment, vel_v, vel_h,
//         temp, batt, modulation, software_name, software_version,
//         uploaders: [{ uploader_callsign, frequency, snr }, ...],
//         ...
//       },
//       ...
//     },
//     ...
//   }
//
// We expose a single helper that:
//   1. Hits the endpoint for a list of callsigns (duration tunable),
//   2. Picks the newest frame per callsign,
//   3. Normalises the field names to the shape the dashboard already uses
//      (latitude/longitude/altitude_m/temperature_c/t/uploader/...).

const BASE = 'https://api.v2.sondehub.org/amateur/telemetry';
// SondeHub only accepts a specific set of duration values. Anything else
// returns 200 with the error text listing these. We pick the closest-but-
// at-least-as-long value for whatever hours the caller asks for.
const VALID_DURATIONS = [
  { label: '15s',  seconds: 15 },
  { label: '1m',   seconds: 60 },
  { label: '30m',  seconds: 30 * 60 },
  { label: '1h',   seconds: 3600 },
  { label: '3h',   seconds: 3 * 3600 },
  { label: '6h',   seconds: 6 * 3600 },
  { label: '12h',  seconds: 12 * 3600 },
  { label: '1d',   seconds: 86400 },
  { label: '3d',   seconds: 3 * 86400 },
  { label: '7d',   seconds: 7 * 86400 },
  { label: '31d',  seconds: 31 * 86400 },
  { label: '186d', seconds: 186 * 86400 },
  { label: '366d', seconds: 366 * 86400 },
];

function closestDurationLabel(hours) {
  const want = Math.max(1, hours) * 3600;
  for (const d of VALID_DURATIONS) {
    if (d.seconds >= want) return d.label;
  }
  return '366d';
}

/**
 * Fetch the newest frame for each callsign.
 * @param {string[]} callsigns  Lower- or upper-case; sent uppercased on the wire.
 * @param {{ durationHours?: number }} [opts]
 * @returns {Promise<Record<string, any>>}  Keyed by lowercase callsign.
 */
export async function fetchLatestForCallsigns(callsigns, opts = {}) {
  const out = {};
  if (!callsigns || callsigns.length === 0) return out;
  const durationLabel = closestDurationLabel(Math.max(1, Math.min(24, opts.durationHours ?? 3)));

  // The API takes a single payload_callsign per request. Fire them in parallel.
  const results = await Promise.allSettled(
    callsigns.map(async (cs) => {
      const url = `${BASE}?payload_callsign=${encodeURIComponent(cs.toUpperCase())}&duration=${durationLabel}`;
      const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (!resp.ok) throw new Error(`sondehub ${cs}: HTTP ${resp.status}`);
      const data = await resp.json();
      return { cs, data };
    }),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { cs, data } = r.value;
    const bucket = data?.[cs.toUpperCase()] || data?.[cs] || {};
    const keys = Object.keys(bucket);
    if (keys.length === 0) continue;
    keys.sort(); // ISO timestamps sort lexicographically
    const latestKey = keys[keys.length - 1];
    const frame = bucket[latestKey];
    if (!frame) continue;
    out[cs.toLowerCase()] = normalize(frame);
  }
  return out;
}

/**
 * Fetch every SondeHub frame (oldest-first) for a single callsign within
 * the window, filtered to those carrying real coordinates. Used by the
 * 3D trajectory tabs in SondehubTelemetry.
 * @param {string} callsign
 * @param {{ durationHours?: number }} [opts]
 * @returns {Promise<any[]>}
 */
export async function fetchSondehubHistory(callsign, opts = {}) {
  const cs = String(callsign || '').trim();
  if (!cs) return [];
  const durationLabel = closestDurationLabel(Math.max(1, Math.min(7 * 24, opts.durationHours ?? 24)));
  const url = `${BASE}?payload_callsign=${encodeURIComponent(cs.toUpperCase())}&duration=${durationLabel}`;
  const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!resp.ok) throw new Error(`sondehub history ${cs}: HTTP ${resp.status}`);
  const data = await resp.json();
  const bucket = data?.[cs.toUpperCase()] || data?.[cs] || {};
  const keys = Object.keys(bucket).sort(); // oldest-first
  const out = [];
  for (const k of keys) {
    const f = bucket[k];
    if (!f) continue;
    const lat = toNumber(f.lat);
    const lon = toNumber(f.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.push(normalize(f));
  }
  return out;
}

function normalize(f) {
  const uploaders = Array.isArray(f.uploaders) ? f.uploaders : [];
  return {
    // Shape the SondehubTelemetry card already understands.
    callsign:            f.payload_callsign,
    t:                   f.datetime ? Date.parse(f.datetime) : Date.now(),
    latitude:            toNumber(f.lat),
    longitude:           toNumber(f.lon),
    altitude_m:          toNumber(f.alt),
    vertical_speed_ms:   toNumber(f.vel_v),
    speed_ms:            toNumber(f.vel_h),
    temperature_c:       toNumber(f.temp),
    battery_v:           toNumber(f.batt),
    pressure_hpa:        toNumber(f.pressure),
    humidity_pct:        toNumber(f.humidity),
    comment:             f.comment ?? null,
    modulation:          f.modulation ?? null,
    software_name:       f.software_name ?? null,
    uploader:            uploaders[0]?.uploader_callsign ?? null,
    uploader_count:      uploaders.length,
    source:              'sondehub-api',
    _raw_time:           f.datetime,
  };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
