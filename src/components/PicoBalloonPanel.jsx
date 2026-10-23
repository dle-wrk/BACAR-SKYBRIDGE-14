import { useEffect, useRef, useState } from 'react';
import { Plus, X, Box, ExternalLink, Rocket } from 'lucide-react';
import { fetchSondehubHistory } from '@/lib/sondehubApi';
import Trajectory3D from '@/components/Trajectory3D';

// Pico balloons publish via APRS and the SondeHub Amateur API — same wire
// shape as our existing SondeHub trajectory tabs, so we reuse the amateur
// endpoint and just scope the stored list under its own key. Each viewer's
// pico list is session-local.

const WINDOWS = [
  { label: '6h',  hours: 6  },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
];
const REFRESH_MS = 60_000;
const LS_KEY = 'bacar_pico_callsigns_v1';

// A couple of long-running pico balloons as a nudge for new viewers.
const SUGGESTED = ['K9YA-11', 'KN4IUD-11', 'WB8ELK-7'];

export default function PicoBalloonPanel() {
  const [callsigns, setCallsigns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      return Array.isArray(saved) && saved.length > 0 ? saved : [];
    } catch { return []; }
  });
  const [active, setActive] = useState(() => callsigns[0] || '');
  const [draft, setDraft] = useState('');
  const [window, setWindow] = useState(72);
  const [histories, setHistories] = useState({});
  const timersRef = useRef({});

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(callsigns)); }
    catch { /* quota */ }
  }, [callsigns]);

  useEffect(() => {
    if (!active && callsigns.length) setActive(callsigns[0]);
    if (active && !callsigns.includes(active)) setActive(callsigns[0] || '');
  }, [callsigns, active]);

  useEffect(() => {
    let cancelled = false;
    for (const t of Object.values(timersRef.current)) clearInterval(t);
    timersRef.current = {};
    for (const cs of callsigns) {
      const key = cs.toLowerCase();
      const pull = async () => {
        setHistories((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), loading: true, error: null } }));
        try {
          const frames = await fetchSondehubHistory(cs, { durationHours: window });
          if (cancelled) return;
          setHistories((prev) => ({ ...prev, [key]: { frames, loading: false, error: null, at: Date.now() } }));
        } catch (exc) {
          if (cancelled) return;
          setHistories((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), loading: false, error: exc?.message || String(exc) } }));
        }
      };
      pull();
      timersRef.current[key] = setInterval(pull, REFRESH_MS);
    }
    return () => {
      cancelled = true;
      for (const t of Object.values(timersRef.current)) clearInterval(t);
      timersRef.current = {};
    };
  }, [callsigns.join(','), window]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCallsign = (raw) => {
    const cs = raw.trim().toUpperCase();
    if (!cs) return;
    if (!callsigns.map((c) => c.toUpperCase()).includes(cs)) {
      setCallsigns([...callsigns, cs]);
    }
    setActive(cs);
  };
  const handleAdd = (e) => {
    e.preventDefault();
    addCallsign(draft);
    setDraft('');
  };
  const handleRemove = (cs) => setCallsigns(callsigns.filter((c) => c !== cs));

  const activeHistory = histories[active?.toLowerCase?.() || '']?.frames || [];
  const activeState = histories[active?.toLowerCase?.() || ''] || {};

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Rocket className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">Pico Balloons</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              amateur sondehub feed · any callsign · session-local list
            </div>
          </div>
        </div>
        <a
          href="https://amateur.sondehub.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
        >
          amateur.sondehub.org
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="mb-4 rounded-2xl border border-border/60 bg-background/40 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-accent/10 p-1.5 text-accent">
              <Box className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-heading font-semibold">3D Trajectory</h3>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                one tab per callsign · own camera per viewer
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                onClick={() => setWindow(w.hours)}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase transition ${
                  window === w.hours
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-border/50 text-muted-foreground hover:border-accent/40 hover:text-accent'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {callsigns.map((cs) => {
            const key = cs.toLowerCase();
            const h = histories[key];
            const isActive = cs === active;
            return (
              <div
                key={cs}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono uppercase transition ${
                  isActive
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-border/50 bg-background/40 text-muted-foreground hover:border-accent/40 hover:text-accent'
                }`}
              >
                <button type="button" onClick={() => setActive(cs)}>
                  {cs}{h?.loading ? ' …' : h?.frames ? ` · ${h.frames.length}` : ''}
                </button>
                <button type="button" onClick={() => handleRemove(cs)} title="Remove" className="rounded hover:text-red-300">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <form onSubmit={handleAdd} className="inline-flex items-center gap-1">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add pico callsign…"
              maxLength={50}
              className="w-56 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-xs font-mono uppercase text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-secondary/60 px-2 py-1 text-xs font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </form>
        </div>

        {callsigns.length === 0 && (
          <div className="mb-3 rounded-xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
            <div className="mb-1.5">Try one of these active picos:</div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((cs) => (
                <button
                  key={cs}
                  type="button"
                  onClick={() => addCallsign(cs)}
                  className="rounded-md border border-border/50 bg-background/60 px-2 py-1 font-mono uppercase text-foreground transition hover:border-accent hover:text-accent"
                >
                  + {cs}
                </button>
              ))}
            </div>
          </div>
        )}

        {!active ? (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            Enter a pico callsign above to plot its trajectory.
          </div>
        ) : activeState.error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-xs text-red-300">
            Fetch failed for {active}: {activeState.error}
          </div>
        ) : (
          <Trajectory3D history={activeHistory} label={`${active} trajectory`} height={460} />
        )}

        <div className="mt-1 text-[10px] text-muted-foreground">
          Pulls last {WINDOWS.find((w) => w.hours === window)?.label} of frames from the SondeHub Amateur API, refreshed every {REFRESH_MS / 1000}s.
          {activeState.at && ` · last pull ${Math.max(0, Math.round((Date.now() - activeState.at) / 1000))}s ago`}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Pico balloons are tiny solar-powered foil balloons that circle the globe for months.
        Most upload position via APRS or the SondeHub Amateur gateway — the same feed we use for amateur telemetry here.
      </div>
    </section>
  );
}
