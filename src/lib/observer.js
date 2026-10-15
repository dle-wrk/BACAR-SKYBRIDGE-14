// @ts-nocheck
// Observer identity (no password) — stored locally. Public access.

// v2 bumps the storage key to force every existing viewer back to the
// IdentifyGate — previous saves (v1) lacked GPS lat/lon on observer
// records and the gate now insists on real coordinates for both roles.
const KEY = 'bacar_observer_v2';

/**
 * @typedef {Object} Observer
 * @property {string} [callsign]
 * @property {string} [name]
 * @property {string} [username]
 * @property {string} [email]
 * @property {'ham' | 'swl' | 'guest' | string} [type]
 */

/**
 * @returns {Observer | null}
 */
export function getObserver() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * @param {Observer} obs
 */
export function setObserver(obs) {
  localStorage.setItem(KEY, JSON.stringify(obs));
}

export function clearObserver() {
  localStorage.removeItem(KEY);
}

/**
 * Maidenhead grid locator: 2 letters + 2 digits (+ optional 2 letters). Length 4-6.
 * @param {string} grid
 * @returns {boolean}
 */
export function isValidGrid(grid) {
  return /^[A-Z]{2}[0-9]{2}([A-Z]{2})?$/.test((grid || '').trim().toUpperCase());
}

/**
 * @param {string} grid
 * @returns {string}
 */
export function normalizeGrid(grid) {
  return (grid || '').trim().toUpperCase();
}

/**
 * @param {Observer | null | undefined} obs
 * @returns {string}
 */
/**
 * Convert a Maidenhead grid locator (4-6 chars) into approximate lat/lon.
 * Used so ham-radio observers get mapped automatically without needing to
 * share a browser geolocation.
 * @param {string} grid
 * @returns {{ lat: number, lon: number } | null}
 */
export function gridToLatLon(grid) {
  const g = (grid || '').trim().toUpperCase();
  if (!isValidGrid(g)) return null;
  const A = 'A'.charCodeAt(0);
  const Z = '0'.charCodeAt(0);
  const lon = (g.charCodeAt(0) - A) * 20 - 180 + (g.charCodeAt(2) - Z) * 2;
  const lat = (g.charCodeAt(1) - A) * 10 - 90 + (g.charCodeAt(3) - Z) * 1;
  // Add 5' x 2.5' subsquare offset if we have the sixth char pair.
  if (g.length >= 6) {
    const lonSub = (g.charCodeAt(4) - A) * (5 / 60);
    const latSub = (g.charCodeAt(5) - A) * (2.5 / 60);
    return { lat: lat + latSub + 1.25 / 60, lon: lon + lonSub + 2.5 / 60 };
  }
  // Center of the 2° x 1° square.
  return { lat: lat + 0.5, lon: lon + 1.0 };
}

export function observerDisplayName(obs) {
  if (!obs) return 'Guest';

  const explicitName = obs.callsign || obs.name || obs.username || obs.email || 'Guest';

  if (obs.type === 'ham') {
    return obs.callsign || obs.name || obs.username || explicitName;
  }

  return obs.name || obs.callsign || obs.username || explicitName;
}