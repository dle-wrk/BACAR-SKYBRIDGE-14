import { useEffect, useState } from 'react';
import { MapPin, Radio } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

function AprsField({ label, value, unit = '' }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold">
        {value ?? '--'}{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export default function AprsTelemetry() {
  const [, setTick] = useState(0);
  const aprs = telemetry.getAprsTelemetry();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">APRS Telemetry</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">aprs.fi feed · not a CUBE</div>
          </div>
        </div>
        <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground">
          {aprs ? 'LIVE APRS' : 'AWAITING DATA'}
        </span>
      </div>

      {!aprs ? (
        <div className="py-5 text-center text-sm text-muted-foreground">Awaiting APRS telemetry from aprs/telemetry...</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <AprsField label="Time" value={aprs.t ? new Date(aprs.t).toLocaleTimeString() : '--'} />
          <AprsField label="Callsign" value={aprs.callsign} />
          <AprsField label="Latitude" value={aprs.latitude} />
          <AprsField label="Longitude" value={aprs.longitude} />
          <AprsField label="Altitude" value={aprs.altitude_m ?? aprs.altitude} unit={aprs.altitude_m !== undefined ? 'm' : ''} />
          <AprsField label="Speed" value={aprs.aprs_speed ?? aprs.speed_ms} />
          <AprsField label="Course" value={aprs.aprs_course ?? aprs.heading_deg} unit="deg" />
          <AprsField label="Symbol" value={aprs.symbol} />
          <AprsField label="Comment" value={aprs.comment} />
          <AprsField label="Status" value={aprs.status} />
          <div className="col-span-2 flex items-center gap-2 px-2 text-[10px] text-muted-foreground sm:col-span-1 lg:col-span-2">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> GPS position from APRS.fi
          </div>
        </div>
      )}
    </section>
  );
}
