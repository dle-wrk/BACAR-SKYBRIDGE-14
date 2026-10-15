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

/**
 * Fetch the newest frame for each callsign.
 * @param {string[]} callsigns  Lower- or upper-case; sent uppercased on the wire.
 * @param {{ durationHours?: number }} [opts]
 * @returns {Promise<Record<string, any>>}  Keyed by lowercase callsign.
 */
export async function fetchLatestForCallsigns(callsigns, opts = {}) {
  const out = {};
  if (!callsigns || callsigns.length === 0) return out;
  const durationHours = Math.max(1, Math.min(24, opts.durationHours ?? 2));

  // The API takes a single payload_callsign per request. Fire them in parallel.
  const results = await Promise.allSettled(
    callsigns.map(async (cs) => {
      const url = `${BASE}?payload_callsign=${encodeURIComponent(cs.toUpperCase())}&duration=${durationHours}h`;
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
