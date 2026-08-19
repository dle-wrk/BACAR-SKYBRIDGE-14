import { useEffect, useRef, useState } from 'react';
import { telemetry } from '@/lib/mqttService';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, TrendingDown, X, Bell, BellOff } from 'lucide-react';

// Listens for burst / rapid-descent alerts from the telemetry engine and
// surfaces them as a top-of-page banner with toast notifications.
export default function BurstAlerts({ className = '' }) {
  const [alerts, setAlerts] = useState(telemetry.getAlerts());
  const [enabled, setEnabled] = useState(true);
  const { toast } = useToast();
  const seen = useRef(new Set());

  useEffect(() => {
    const unsub = telemetry.subscribeAlerts((list) => {
      if (!enabled) { setAlerts(list); return; }
      list.forEach((a) => {
        if (!seen.current.has(a.id)) {
          seen.current.add(a.id);
          toast({
            title: a.type === 'burst' ? 'BURST DETECTED' : 'Rapid Descent',
            description: `${a.cube_name} — ${a.message}`,
            variant: a.type === 'burst' ? 'destructive' : 'default',
            duration: 9000,
          });
        }
      });
      setAlerts(list);
    });
    return unsub;
  }, [toast, enabled]);

  const visibleAlerts = alerts.slice(0, 3);

  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 backdrop-blur-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center rounded-full bg-amber-500/15 p-1.5 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <h3 className="font-heading font-semibold text-sm sm:text-base">Burst & Descent Alerts</h3>
          {alerts.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
              {alerts.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setEnabled((e) => !e)}
            className="inline-flex items-center justify-center rounded-lg border border-border/60 bg-background/40 p-1.5 text-muted-foreground transition hover:text-foreground"
            title={enabled ? 'Mute notifications' : 'Enable notifications'}
          >
            {enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>
          {alerts.length > 0 && (
            <button
              onClick={() => telemetry.clearAlerts()}
              className="rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-[10px] font-mono text-muted-foreground transition hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 opacity-40" />
            <span>No burst events yet. Monitoring all CUBEs in real time.</span>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3 space-y-2">
          {visibleAlerts.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/30 px-3 py-2">
              <span className={`mt-0.5 shrink-0 ${a.type === 'burst' ? 'text-red-400' : 'text-amber-400'}`}>
                {a.type === 'burst' ? <AlertTriangle className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{a.cube_name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{a.cube_id}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted-foreground">
                  {a.altitude_m != null && <span>{(a.altitude_m / 1000).toFixed(2)} km</span>}
                  {a.vertical_speed_ms != null && <span>{a.vertical_speed_ms} m/s</span>}
                  <span>{new Date(a.t).toLocaleTimeString()}</span>
                </div>
              </div>
              <button
                onClick={() => telemetry.dismissAlert(a.id)}
                className="rounded p-1 text-muted-foreground transition hover:text-foreground"
                aria-label="Dismiss alert"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}