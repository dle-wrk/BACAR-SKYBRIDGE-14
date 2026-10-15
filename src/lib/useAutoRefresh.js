import { useEffect, useRef } from 'react';

// Auto-refresh when a new deploy ships. Every 5 min we fetch /index.html
// with a cache-bust, parse out the asset script hash the fresh HTML
// references, and compare it to the hash the currently-loaded page has.
// Different hash → location.reload() picks up the new bundle.
// Same hash → nothing. We never reload a session that isn't actually
// behind, so active work (SSTV captures, chat drafts) isn't thrown away
// unnecessarily.
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SCRIPT_RE = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/i;

function currentBundlePath() {
  const el = Array.from(document.scripts).find((s) => s.src.includes('/assets/index-'));
  if (!el) return null;
  try {
    return new URL(el.src).pathname;
  } catch {
    return null;
  }
}

async function fetchDeployedBundlePath() {
  // Cache-bust so we always see what the edge is serving right now.
  const resp = await fetch(`/index.html?__cb=${Date.now()}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`index.html ${resp.status}`);
  const html = await resp.text();
  const m = html.match(SCRIPT_RE);
  return m ? m[1] : null;
}

export function useAutoRefresh() {
  const baselineRef = useRef(null);

  useEffect(() => {
    baselineRef.current = currentBundlePath();
    if (!baselineRef.current) return undefined; // nothing to compare

    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      try {
        const latest = await fetchDeployedBundlePath();
        if (!latest || cancelled) return;
        if (latest !== baselineRef.current) {
          // New deploy — pick it up. hardReload avoids SW/HTTP-cache stickiness.
          window.location.reload();
        }
      } catch { /* network blip; try again next tick */ }
    };

    const id = setInterval(check, CHECK_INTERVAL_MS);
    // Also check when the tab comes back into focus after being away a while —
    // if someone left the dashboard open overnight it'll self-update on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
