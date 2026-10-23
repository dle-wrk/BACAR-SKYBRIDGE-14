import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MapPin, Plus, Satellite, Search, X, Box } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';
import { CALLSIGN_CARDS, CALLSIGN_PREFIX } from '@/lib/mqttService';
import { useUserCallsigns } from '@/lib/useUserCallsigns';
import { fetchLatestForCallsigns, fetchSondehubHistory } from '@/lib/sondehubApi';
import Trajectory3D from '@/components/Trajectory3D';

const TRAJECTORY_WINDOWS = [
  { label: '6h',  hours: 6  },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
];
const TRAJECTORY_REFRESH_MS = 60_000;
const SONDEHUB_TRAJ_LS_KEY = 'bacar_sondehub_trajectory_callsigns_v1';

// Standalone 3D trajectory section inside the SondeHub tab. Mirrors the
// APRS version — tab per callsign, any callsign can be added, each viewer
// has their own camera (uirevision + Reset button on the plot card).
function SondehubTrajectoryTabs() {
  const [callsigns, setCallsigns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SONDEHUB_TRAJ_LS_KEY) || '[]');
      return Array.isArray(saved) && saved.length > 0 ? saved : ['ZR6LJK'];
    } catch { return ['ZR6LJK']; }
  });
  const [active, setActive] = useState(() => callsigns[0] || '');
  const [draft, setDraft] = useState('');
  const [window, setWindow] = useState(24);
  const [histories, setHistories] = useState({});
  const timersRef = useRef({});

  useEffect(() => {
    try { localStorage.setItem(SONDEHUB_TRAJ_LS_KEY, JSON.stringify(callsigns)); }
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
      timersRef.current[key] = setInterval(pull, TRAJECTORY_REFRESH_MS);
    }
    return () => {
      cancelled = true;
      for (const t of Object.values(timersRef.current)) clearInterval(t);
      timersRef.current = {};
    };
  }, [callsigns.join(','), window]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = (e) => {
    e.preventDefault();
    const cs = draft.trim().toUpperCase();
    if (!cs) return;
    if (!callsigns.map((c) => c.toUpperCase()).includes(cs)) {
      setCallsigns([...callsigns, cs]);
    }
    setActive(cs);
    setDraft('');
  };
  const handleRemove = (cs) => setCallsigns(callsigns.filter((c) => c !== cs));

  const activeHistory = histories[active?.toLowerCase?.() || '']?.frames || [];
  const activeState = histories[active?.toLowerCase?.() || ''] || {};

  return (
    <div className="mb-6 rounded-2xl border border-border/60 bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Box className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-heading font-semibold">3D Trajectory</h3>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              any sondehub callsign · one tab each · own camera per viewer
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {TRAJECTORY_WINDOWS.map((w) => (
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
            placeholder="Add callsign…"
            maxLength={10}
            className="w-32 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-xs font-mono uppercase text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
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

      {!active ? (
        <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
          Enter a callsign above to plot its trajectory.
        </div>
      ) : activeState.error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-xs text-red-300">
          Fetch failed for {active}: {activeState.error}
        </div>
      ) : (
        <Trajectory3D history={activeHistory} label={`${active} trajectory`} height={460} />
      )}

      <div className="mt-1 text-[10px] text-muted-foreground">
        Pulls last {TRAJECTORY_WINDOWS.find((w) => w.hours === window)?.label} of SondeHub frames, refreshed every {TRAJECTORY_REFRESH_MS / 1000}s.
        {activeState.at && ` · last pull ${Math.max(0, Math.round((Date.now() - activeState.at) / 1000))}s ago`}
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 30_000; // SondeHub updates every ~15-30 s per callsign

const SONDEHUB_LINK   = 'https://amateur.sondehub.org/';
const SONDEHUB_CALL   = (cs) => `https://amateur.sondehub.org/?focus=${encodeURIComponent(cs.toUpperCase())}`;

function Field({ label, value, unit = '' }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">
        {value ?? '--'}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function CallsignCard({ callsign, data, onRemove }) {
  const fresh = data && (Date.now() - (data.t || 0)) < 60_000;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Satellite className="h-3.5 w-3.5 shrink-0 text-accent" />
          <a
            href={SONDEHUB_CALL(callsign)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${callsign.toUpperCase()} on amateur.sondehub.org`}
            className="truncate font-mono text-sm font-semibold uppercase tracking-wider hover:text-accent transition"
          >
            {callsign}
          </a>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase ${
            fresh
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-border/60 text-muted-foreground'
          }`}>
            {fresh ? 'live' : 'awaiting'}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(callsign)}
              title="Remove this callsign from your list"
              className="rounded-md p-0.5 text-muted-foreground transition hover:bg-secondary hover:text-red-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {!data ? (
        <div className="py-3 text-center text-xs text-muted-foreground">No frames yet</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Field label="Time" value={data.t ? new Date(data.t).toLocaleTimeString() : '--'} />
          <Field label="Latitude" value={data.latitude?.toFixed?.(4) ?? data.latitude} />
          <Field label="Longitude" value={data.longitude?.toFixed?.(4) ?? data.longitude} />
          <Field label="Altitude" value={data.altitude_m ?? data.altitude} unit={data.altitude_m !== undefined ? 'm' : ''} />
          <Field label="Vspeed" value={data.vertical_speed_ms} unit="m/s" />
          <Field label="Pressure" value={data.pressure_hpa} unit="hPa" />
          <Field label="Temp" value={data.temperature_c} unit="°C" />
          <Field label="Uploader" value={data.uploader} />
          <Field label="Comment" value={data.comment} />
        </div>
      )}
    </div>
  );
}

export default function SondehubTelemetry() {
  const [, setTick] = useState(0);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState(null);
  const [lastPollAt, setLastPollAt] = useState(0);
  useEffect(() => telemetry.subscribe(() => setTick((t) => t + 1)), []);

  const byCallsign = telemetry.getSondehubByCallsign();
  const userCs = useUserCallsigns();

  const { pinned, userList, extras } = useMemo(() => {
    const pinnedSet = new Set(CALLSIGN_CARDS);
    const userSet = new Set(userCs.list.filter((c) => !pinnedSet.has(c)));
    const extraList = [];
    for (const cs of Object.keys(byCallsign)) {
      if (pinnedSet.has(cs) || userSet.has(cs)) continue;
      if (cs.startsWith(`${CALLSIGN_PREFIX}-`)) extraList.push(cs);
    }
    return {
      pinned:   CALLSIGN_CARDS,
      userList: Array.from(userSet),
      extras:   extraList,
    };
  }, [byCallsign, userCs.list]);

  // Poll the public SondeHub Amateur API for every tracked callsign.
  // CORS-enabled, no key needed — same endpoint the official tracker at
  // amateur.sondehub.org (projecthorus/sondehub-amateur-tracker, MIT) uses.
  const tracked = useMemo(
    () => [...pinned, ...userList, ...extras],
    [pinned, userList, extras],
  );
  useEffect(() => {
    if (tracked.length === 0) return undefined;
    let cancelled = false;
    const pull = async () => {
      setPolling(true);
      setPollError(null);
      try {
        const batch = await fetchLatestForCallsigns(tracked, { durationHours: 24 });
        if (cancelled) return;
        telemetry.mergeSondehubFrames(batch);
        setLastPollAt(Date.now());
      } catch (exc) {
        if (!cancelled) setPollError(exc?.message || String(exc));
      } finally {
        if (!cancelled) setPolling(false);
      }
    };
    pull();
    const id = setInterval(pull, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [tracked.join(',')]);  // eslint-disable-line react-hooks/exhaustive-deps

  const total = pinned.length + userList.length + extras.length;
  const anyFresh = [...pinned, ...userList, ...extras].some(
    (cs) => byCallsign[cs] && (Date.now() - (byCallsign[cs].t || 0)) < 60_000,
  );

  const [newCs, setNewCs] = useState('');
  const [search, setSearch] = useState('');

  const handleAdd = (e) => {
    e.preventDefault();
    const cs = newCs.trim();
    if (!cs) return;
    userCs.add(cs);
    setNewCs('');
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) window.open(SONDEHUB_LINK, '_blank', 'noopener');
    else window.open(SONDEHUB_CALL(q), '_blank', 'noopener');
  };

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Satellite className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">SondeHub Telemetry</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              sondehub.org feed · tracking {total} callsign{total === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          anyFresh
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-border/60 text-muted-foreground'
        }`}>
          {anyFresh ? 'LIVE SONDEHUB' : 'AWAITING DATA'}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={handleAdd} className="flex items-center gap-1.5">
          <input
            type="text"
            value={newCs}
            onChange={(e) => setNewCs(e.target.value)}
            placeholder="Add callsign (e.g. ZS6ABC)"
            maxLength={10}
            className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/60 px-2.5 py-1.5 text-xs font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </form>
        <form onSubmit={handleSearch} className="flex items-center gap-1.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SondeHub"
            maxLength={10}
            className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/60 px-2.5 py-1.5 text-xs font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
            title="Opens SondeHub in a new tab for the entered callsign."
          >
            <Search className="h-3.5 w-3.5" />
            Open on SondeHub
          </button>
        </form>
        <a
          href={SONDEHUB_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent ml-auto"
        >
          sondehub.org
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Standalone 3D trajectory tabs — one tab per callsign, add any callsign. */}
      <SondehubTrajectoryTabs />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pinned.map((cs) => (
          <CallsignCard key={cs} callsign={cs} data={byCallsign[cs]} />
        ))}
        {userList.map((cs) => (
          <CallsignCard key={cs} callsign={cs} data={byCallsign[cs]} onRemove={userCs.remove} />
        ))}
        {extras.map((cs) => (
          <CallsignCard key={cs} callsign={cs} data={byCallsign[cs]} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          Pinned {CALLSIGN_CARDS.join(', ').toUpperCase()} + your additions + any {CALLSIGN_PREFIX.toUpperCase()}-* on the feed.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ExternalLink className="h-3 w-3" />
          <a
            href="https://github.com/projecthorus/sondehub-amateur-tracker"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline hover:text-accent"
          >
            Live telemetry via api.v2.sondehub.org
          </a>
          {polling ? ' · polling…'
            : pollError ? ` · poll error: ${pollError}`
            : lastPollAt ? ` · last pull ${Math.max(0, Math.round((Date.now() - lastPollAt) / 1000))}s ago`
            : ' · poll idle'}
        </span>
      </div>
    </section>
  );
}
