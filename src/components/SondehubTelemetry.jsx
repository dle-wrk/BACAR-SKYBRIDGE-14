import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MapPin, Plus, Satellite, Search, X } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';
import { CALLSIGN_CARDS, CALLSIGN_PREFIX } from '@/lib/mqttService';
import { useUserCallsigns } from '@/lib/useUserCallsigns';
import { fetchLatestForCallsigns } from '@/lib/sondehubApi';

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
        const batch = await fetchLatestForCallsigns(tracked, { durationHours: 2 });
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
