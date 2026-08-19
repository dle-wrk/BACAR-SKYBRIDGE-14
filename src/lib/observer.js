// Observer identity (no password) — stored locally. Public access.
const KEY = 'bacar_observer_v1';

export function getObserver() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setObserver(obs) {
  localStorage.setItem(KEY, JSON.stringify(obs));
}

export function clearObserver() {
  localStorage.removeItem(KEY);
}

// Maidenhead grid locator: 2 letters + 2 digits (+ optional 2 letters). Length 4-6.
export function isValidGrid(grid) {
  return /^[A-Z]{2}[0-9]{2}([A-Z]{2})?$/.test((grid || '').trim().toUpperCase());
}

export function normalizeGrid(grid) {
  return (grid || '').trim().toUpperCase();
}

export function observerDisplayName(obs) {
  if (!obs) return 'Guest';

  const explicitName = obs.callsign || obs.name || obs.username || obs.email || 'Guest';

  if (obs.type === 'ham') {
    return obs.callsign || obs.name || obs.username || explicitName;
  }

  return obs.name || obs.callsign || obs.username || explicitName;
}