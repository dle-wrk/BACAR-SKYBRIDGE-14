// Thin client for SondeHub's PROFESSIONAL radiosonde endpoint.
//
// Different from amateur: amateur traffic is keyed by payload_callsign and
// lives at /amateur/telemetry; weather radiosondes are keyed by serial and
// live at /sonde/<serial>. Example URL the user types into the UI:
//   https://sondehub.org/X2642772            (viewer page)
//   https://api.v2.sondehub.org/sonde/X2642772   (what we hit)
//
// The response is a flat object keyed by ISO timestamp with the usual
// lat/lon/alt/vel_h/vel_v/temp/uploader fields. We normalise it into the
// same shape Trajectory3D expects.

const BASE = 'https://api.v2.sondehub.org/sonde';

/**
 * Fetch every recent frame for a sonde serial (oldest-first, lat/lon
 * filtered). The endpoint does not accept a duration — it returns the
 * sonde's recent history as the service chooses to keep it.
 * @param {string} serial e.g. "X2642772"
 * @returns {Promise<any[]>}
 */
export async function fetchSondeHistory(serial) {
  const s = String(serial || '').trim();
  if (!s) return [];
  const url = `${BASE}/${encodeURIComponent(s.toUpperCase())}`;
  const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!resp.ok) throw new Error(`sonde ${s}: HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data || typeof data !== 'object') return [];
  const keys = Object.keys(data).sort();  // ISO timestamps sort lexicographically → oldest-first
  const out = [];
  for (const k of keys) {
    const f = data[k];
    if (!f) continue;
    const lat = toNumber(f.lat);
    const lon = toNumber(f.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.push(normalize(f, s));
  }
  return out;
}

function normalize(f, fallbackSerial) {
  return {
    callsign:          f.serial || fallbackSerial,
    serial:            f.serial || fallbackSerial,
    t:                 f.datetime ? Date.parse(f.datetime) : Date.now(),
    latitude:          toNumber(f.lat),
    longitude:         toNumber(f.lon),
    altitude_m:        toNumber(f.alt),
    vertical_speed_ms: toNumber(f.vel_v),
    speed_ms:          toNumber(f.vel_h),
    heading_deg:       toNumber(f.heading),
    temperature_c:     toNumber(f.temp),
    humidity_pct:      toNumber(f.humidity),
    pressure_hpa:      toNumber(f.pressure),
    frequency_mhz:     toNumber(f.frequency),
    sonde_type:        f.type ?? null,
    uploader:          f.uploader_callsign ?? null,
    frame:             toNumber(f.frame),
    source:            'sondehub-sonde',
    _raw_time:         f.datetime,
  };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
