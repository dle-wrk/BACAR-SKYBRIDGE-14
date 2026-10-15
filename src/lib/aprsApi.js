// APRS client — pulls APRS traffic for a list of callsigns from
// SondeHub's amateur telemetry endpoint, which runs an APRS-IS gateway
// and tags inbound APRS frames with modulation: "APRS". Same endpoint
// the SondeHub tracker uses; CORS-enabled, no key required.
//
// Why not aprs.fi? Their REST API (api.aprs.fi) requires a per-user
// API key and would expose it in a static site bundle. SondeHub's
// gateway covers the same traffic for the amateur-balloon community
// and is key-free.

const BASE = 'https://api.v2.sondehub.org/amateur/telemetry';

const VALID_DURATIONS = [
  { label: '1h',   seconds: 3600 },
  { label: '3h',   seconds: 3 * 3600 },
  { label: '6h',   seconds: 6 * 3600 },
  { label: '12h',  seconds: 12 * 3600 },
  { label: '1d',   seconds: 86400 },
  { label: '3d',   seconds: 3 * 86400 },
  { label: '7d',   seconds: 7 * 86400 },
];

function closestDurationLabel(hours) {
  const want = Math.max(1, hours) * 3600;
  for (const d of VALID_DURATIONS) {
    if (d.seconds >= want) return d.label;
  }
  return '7d';
}

/**
 * Fetch the newest APRS frame (modulation === "APRS") for each callsign.
 * @param {string[]} callsigns
 * @param {{ durationHours?: number }} [opts]
 * @returns {Promise<Record<string, any>>}
 */
export async function fetchLatestAprsForCallsigns(callsigns, opts = {}) {
  const out = {};
  if (!callsigns || callsigns.length === 0) return out;
  const label = closestDurationLabel(Math.max(1, Math.min(72, opts.durationHours ?? 6)));

  const results = await Promise.allSettled(
    callsigns.map(async (cs) => {
      const url = `${BASE}?payload_callsign=${encodeURIComponent(cs.toUpperCase())}&duration=${label}`;
      const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (!resp.ok) throw new Error(`aprs ${cs}: HTTP ${resp.status}`);
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
    // Walk newest-first and pick the first APRS-tagged frame.
    keys.sort((a, b) => b.localeCompare(a));
    // Prefer the newest APRS frame that carries real coordinates. LoRa
    // trackers often emit {lat:0, lon:0} as a "no fix yet" placeholder;
    // those have the right modulation but aren't useful on the map.
    let fallback = null;
    for (const k of keys) {
      const f = bucket[k];
      if (!f) continue;
      const mod = String(f.modulation || '').toUpperCase();
      const looksAprs = mod === 'APRS' || /qA[CORSUXZ]|TCPIP|APRS/i.test(f.path || f.raw || '');
      if (!looksAprs) continue;
      const lat = toNumber(f.lat);
      const lon = toNumber(f.lon);
      const hasFix = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
      if (hasFix) {
        out[cs.toLowerCase()] = normalize(f);
        fallback = null;
        break;
      }
      if (!fallback) fallback = f;
    }
    if (fallback && !out[cs.toLowerCase()]) {
      out[cs.toLowerCase()] = normalize(fallback);
    }
  }
  return out;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalize(f) {
  return {
    callsign:          f.payload_callsign,
    t:                 f.datetime ? Date.parse(f.datetime) : Date.now(),
    latitude:          toNumber(f.lat),
    longitude:         toNumber(f.lon),
    altitude_m:        toNumber(f.alt),
    aprs_speed:        toNumber(f.vel_h),
    aprs_course:       toNumber(f.heading),
    speed_ms:          toNumber(f.vel_h),
    heading_deg:       toNumber(f.heading),
    symbol:            f.symbol ?? null,
    comment:           f.comment ?? null,
    status:            f.status ?? null,
    uploader:          f.uploader_callsign ?? null,
    path:              f.path ?? null,
    aprs_tocall:       f.aprs_tocall ?? null,
    source:            'sondehub-aprs',
    _raw_time:         f.datetime,
  };
}
