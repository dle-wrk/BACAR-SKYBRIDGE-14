import { useEffect, useRef, useState } from 'react';
import { telemetry } from '@/lib/mqttService';
import { observerDisplayName } from '@/lib/observer';
import { Radio, Settings, LogOut, Wifi, Activity } from 'lucide-react';

export default function TopBar({ observer, onSignOut, onOpenSettings }) {
  const [mode, setMode] = useState(telemetry.isSim() ? 'sim' : telemetry.isLive() ? 'live' : 'idle');
  const [cubeCount, setCubeCount] = useState(0);
  const [active, setActive] = useState(0);
  const ref = useRef(false);

  useEffect(() => {
    const unsub = telemetry.subscribe((cubes) => {
      setCubeCount(cubes.length);
      setActive(cubes.filter((c) => c.telemetry).length);
      setMode(telemetry.isSim() ? 'sim' : telemetry.isLive() ? 'live' : 'idle');
    });
    if (!ref.current) { telemetry.connect(); ref.current = true; }
    return unsub;
  }, []);

  const statusLabel = mode === 'live' ? 'LIVE MQTT' : mode === 'sim' ? 'SIMULATION' : 'OFFLINE';
  const statusColor = mode === 'live' ? 'text-emerald-300' : mode === 'sim' ? 'text-amber-300' : 'text-muted-foreground';

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
              : mode === 'sim'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-muted-foreground/20 bg-muted/20 text-muted-foreground'
          }`}>
            <Wifi className={`w-3.5 h-3.5 ${statusColor}`} />
            <span className={statusColor}>{statusLabel}</span>
          </div>
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
    </header>
  );
}