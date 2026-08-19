import { useEffect, useState } from 'react';
import { Gauge, Radio } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

function PicoField({ label, value, unit = '' }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">
        {value ?? 'N/A'}{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function PicoBalloonTelemetry() {
  const [, setTick] = useState(0);
  const pico = telemetry.getPicoTelemetry();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">Pico Balloon Telemetry</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">BACAR-14D · pico balloon · not a CUBE</div>
          </div>
        </div>
        <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground">
          {pico ? 'LIVE PICO' : 'PLACEHOLDER'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <PicoField label="Time" value={pico?.t ? new Date(pico.t).toLocaleTimeString() : undefined} />
        <PicoField label="Altitude" value={pico?.altitude_m ?? pico?.altitude} unit={pico?.altitude_m !== undefined ? 'm' : ''} />
        <PicoField label="Speed" value={pico?.speed_ms ?? pico?.speed} unit={pico?.speed_ms !== undefined ? 'm/s' : ''} />
        <PicoField label="Temperature" value={pico?.temperature_c ?? pico?.temperature} unit={pico?.temperature_c !== undefined ? '°C' : ''} />
        <PicoField label="Pressure" value={pico?.pressure_hpa ?? pico?.pressure} unit={pico?.pressure_hpa !== undefined ? 'hPa' : ''} />
        <PicoField label="Battery" value={pico?.battery_v ?? pico?.battery} unit={pico?.battery_v !== undefined ? 'V' : ''} />
        <PicoField label="Status" value={pico?.status} />
      </div>

      {!pico && (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" /> Placeholder values will be replaced by the pico/telemetry feed.
        </div>
      )}
    </section>
  );
}
