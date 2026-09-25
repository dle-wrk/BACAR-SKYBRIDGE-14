// @ts-nocheck
// Observer identity (no password) — stored locally. Public access.

const KEY = 'bacar_observer_v1';

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
export function observerDisplayName(obs) {
  if (!obs) return 'Guest';

  const explicitName = obs.callsign || obs.name || obs.username || obs.email || 'Guest';

  if (obs.type === 'ham') {
    return obs.callsign || obs.name || obs.username || explicitName;
  }

  return obs.name || obs.callsign || obs.username || explicitName;
}