import { useEffect, useState } from 'react';
import { MapPin, Radio } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

function SondehubField({ label, value, unit = '' }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">
        {value ?? '--'}{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function SondehubTelemetry() {
  const [, setTick] = useState(0);
  const sondehub = telemetry.getSondehubTelemetry();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">SondeHub Telemetry</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">sondehub feed · not a CUBE</div>
          </div>
        </div>
        <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground">
          {sondehub ? 'LIVE SONDEHUB' : 'AWAITING DATA'}
        </span>
      </div>

      {!sondehub ? (
        <div className="py-5 text-center text-sm text-muted-foreground">Awaiting SondeHub telemetry from sondehub/telemetry...</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SondehubField label="Time" value={sondehub.t ? new Date(sondehub.t).toLocaleTimeString() : '--'} />
          <SondehubField label="Callsign" value={sondehub.callsign} />
          <SondehubField label="Latitude" value={sondehub.latitude} />
          <SondehubField label="Longitude" value={sondehub.longitude} />
          <SondehubField label="Altitude" value={sondehub.altitude_m ?? sondehub.altitude} unit={sondehub.altitude_m !== undefined ? 'm' : ''} />
          <SondehubField label="Temperature" value={sondehub.temperature_c ?? sondehub.temperature} unit={sondehub.temperature_c !== undefined ? '°C' : ''} />
          <SondehubField label="Battery" value={sondehub.battery_v ?? sondehub.battery} unit={sondehub.battery_v !== undefined ? 'V' : ''} />
          <SondehubField label="Frequency" value={sondehub.frequency} unit="MHz" />
          <SondehubField label="Uploader" value={sondehub.uploader} />
          <SondehubField label="Status" value={sondehub.status} />
          <div className="col-span-2 flex items-center gap-2 px-2 text-[10px] text-muted-foreground sm:col-span-1 lg:col-span-2">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> Position from SondeHub
          </div>
        </div>
      )}
    </section>
  );
}
