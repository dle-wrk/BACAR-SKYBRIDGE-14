import { useEffect, useRef, useState } from 'react';
import { telemetry } from '@/lib/mqttService';
import { observerDisplayName } from '@/lib/observer';
import { Radio, Settings, LogOut, Wifi, Activity } from 'lucide-react';

// Freshness thresholds — above STALE_MS the feed is amber; above DEAD_MS red.
// 30 s matches typical cube telemetry cadence; 60 s means something broke.
const STALE_MS = 30_000;
const DEAD_MS  = 60_000;

function formatAgo(ms) {
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3600_000)}h ago`;
}

export default function TopBar({ observer, onSignOut, onOpenSettings, activeFeed, onFeedChange }) {
  const [mode, setMode] = useState(telemetry.isLive() ? 'live' : 'idle');
  const [cubeCount, setCubeCount] = useState(0);
  const [active, setActive] = useState(0);
  const [lastMsgAt, setLastMsgAt] = useState(telemetry.getLastMessageAt());
  const [, setClockTick] = useState(0);
  const ref = useRef(false);

  useEffect(() => {
    const unsub = telemetry.subscribe((cubes) => {
      setCubeCount(cubes.length);
      setActive(cubes.filter((c) => c.telemetry).length);
      setMode(telemetry.isLive() ? 'live' : 'idle');
      setLastMsgAt(telemetry.getLastMessageAt());
    });
    if (!ref.current) { telemetry.connect(); ref.current = true; }
    // Second ticker so the "Xs ago" counter advances even when no new MQTT
    // message is arriving — that's exactly the case we want to make visible.
    const timer = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => { unsub(); clearInterval(timer); };
  }, []);

  const statusLabel = mode === 'live' ? 'LIVE MQTT' : 'OFFLINE';
  const statusColor = mode === 'live' ? 'text-emerald-300' : 'text-muted-foreground';

  // Freshness pill: green when fresh, amber when stale, red when dead.
  const age = lastMsgAt ? Date.now() - lastMsgAt : null;
  const freshness = age == null ? 'none'
                  : age < STALE_MS ? 'fresh'
                  : age < DEAD_MS  ? 'stale'
                  : 'dead';
  const freshColor = freshness === 'fresh' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                   : freshness === 'stale' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                   : freshness === 'dead'  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                                           : 'border-muted-foreground/20 bg-muted/20 text-muted-foreground';
  const freshLabel = freshness === 'none' ? 'no msgs yet' : `updated ${formatAgo(age)}`;

  return (
    <header className="sticky top-0 z-30 strat-card border-b border-border/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Radio className="w-7 h-7 text-accent strat-glow" />
          </div>
          <div className="leading-tight">
            <div className="font-heading font-bold text-base sm:text-lg">Skybridge 14</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hidden sm:block">
              BACAR Cube Telemetry
            </div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden md:flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">CUBEs</span>
            <span className="font-mono font-semibold">{active}/{cubeCount}</span>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono font-semibold ${
            mode === 'live'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-muted-foreground/20 bg-muted/20 text-muted-foreground'
          }`}>
            <Wifi className={`w-3.5 h-3.5 ${statusColor}`} />
            <span className={statusColor}>{statusLabel}</span>
          </div>
          {mode === 'live' && (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono ${freshColor}`}
              title={lastMsgAt
                ? `Last MQTT message received at ${new Date(lastMsgAt).toLocaleTimeString()}. Any topic.`
                : 'Connected but no messages received yet.'}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              <span>{freshLabel}</span>
            </div>
          )}
        </div>

        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg hover:bg-secondary transition text-muted-foreground hover:text-foreground"
          title="Connection settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-border">
          <div className="text-right hidden sm:block leading-tight">
            <div className="text-sm font-medium">{observerDisplayName(observer)}</div>
            <div className="text-[10px] text-muted-foreground">
              {observer?.type === 'ham' ? observer.grid : observer?.location}
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="p-2 rounded-lg hover:bg-secondary transition text-muted-foreground hover:text-foreground"
            title="Change identity"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-1 border-t border-border/40" role="tablist" aria-label="Telemetry feeds">
        {[
          { id: 'aprs',     label: 'APRS' },
          { id: 'sondehub', label: 'SondeHub' },
          { id: 'pico',     label: 'Pico Balloon', disabled: true },
          { id: 'rotator',  label: 'Rotator',      disabled: true },
          { id: 'sstv',     label: 'SSTV' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeFeed === tab.id}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onFeedChange(tab.id)}
            title={tab.disabled ? 'Disabled — telemetry source retired' : undefined}
            className={`border-b-2 px-3 py-2 text-xs font-mono uppercase tracking-wider transition ${
              tab.disabled
                ? 'border-transparent text-muted-foreground/40 cursor-not-allowed'
                : activeFeed === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
}