import { useEffect, useState } from 'react';
import { Antenna, MapPin, Radio } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

function RotatorField({ label, value, unit = '' }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">
        {value ?? '--'}{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function RotatorTelemetry() {
  const [, setTick] = useState(0);
  const rotator = telemetry.getRotatorTelemetry();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Antenna className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">Rotator Telemetry</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">base station antenna · not a CUBE</div>
          </div>
        </div>
        <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground">
          {rotator ? 'LIVE ROTATOR' : 'AWAITING DATA'}
        </span>
      </div>

      {!rotator ? (
        <div className="py-5 text-center text-sm text-muted-foreground">Awaiting base-station rotator data from rotator/telemetry...</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <RotatorField label="Time" value={rotator.t ? new Date(rotator.t).toLocaleTimeString() : '--'} />
          <RotatorField label="Horizontal Angle" value={rotator.horizontal_angle} unit="deg" />
          <RotatorField label="Vertical Angle" value={rotator.vertical_angle} unit="deg" />
          <RotatorField label="GPS Lat" value={rotator.latitude} />
          <RotatorField label="GPS Lon" value={rotator.longitude} />
          <RotatorField label="Tracking Mode" value={rotator.tracking_mode} />
          <RotatorField label="Status" value={rotator.status} />
          <RotatorField label="Errors" value={Array.isArray(rotator.errors) ? rotator.errors.join(', ') : rotator.errors} />
          <div className="col-span-2 flex items-center gap-2 px-2 text-[10px] text-muted-foreground sm:col-span-1 lg:col-span-3">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> Base-station GPS position
            <Radio className="ml-1 h-3.5 w-3.5 shrink-0" /> Antenna pointing telemetry
          </div>
        </div>
      )}
    </section>
  );
}
