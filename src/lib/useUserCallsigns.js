import { useCallback, useEffect, useState } from 'react';
import { USER_CALLSIGNS_KEY } from '@/lib/mqttService';

// Each viewer keeps their own list of extra callsigns to render cards for.
// Stored in localStorage; not shared via MQTT. Lower-cased on write.
function readStore() {
  try {
    const raw = localStorage.getItem(USER_CALLSIGNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function writeStore(list) {
  try {
    localStorage.setItem(USER_CALLSIGNS_KEY, JSON.stringify(list));
  } catch { /* storage disabled */ }
}

export function useUserCallsigns() {
  const [list, setList] = useState(readStore);

  // Keep multiple tabs in sync via the storage event.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === USER_CALLSIGNS_KEY) setList(readStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((raw) => {
    const cs = String(raw || '').toLowerCase().trim();
    if (!cs) return;
    setList((prev) => {
      if (prev.includes(cs)) return prev;
      const next = [...prev, cs];
      writeStore(next);
      return next;
    });
  }, []);

  const remove = useCallback((raw) => {
    const cs = String(raw || '').toLowerCase().trim();
    setList((prev) => {
      if (!prev.includes(cs)) return prev;
      const next = prev.filter((c) => c !== cs);
      writeStore(next);
      return next;
    });
  }, []);

  return { list, add, remove };
}
