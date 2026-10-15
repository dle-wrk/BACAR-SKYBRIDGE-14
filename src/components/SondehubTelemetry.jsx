import { useEffect, useMemo, useState } from 'react';
import { MapPin, Satellite } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';
import { CALLSIGN_CARDS, CALLSIGN_PREFIX } from '@/lib/mqttService';

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

function CallsignCard({ callsign, data }) {
  const fresh = data && (Date.now() - (data.t || 0)) < 60_000;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Satellite className="h-3.5 w-3.5 text-accent" />
          <span className="font-mono text-sm font-semibold uppercase tracking-wider">{callsign}</span>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase ${
          fresh
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-border/60 text-muted-foreground'
        }`}>
          {fresh ? 'live' : 'awaiting'}
        </span>
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
  useEffect(() => telemetry.subscribe(() => setTick((t) => t + 1)), []);

  const byCallsign = telemetry.getSondehubByCallsign();

  const callsignList = useMemo(() => {
    const list = [...CALLSIGN_CARDS];
    for (const cs of Object.keys(byCallsign)) {
      if (!list.includes(cs) && cs.startsWith(`${CALLSIGN_PREFIX}-`)) list.push(cs);
    }
    return list;
  }, [byCallsign]);

  const anyFresh = callsignList.some(
    (cs) => byCallsign[cs] && (Date.now() - (byCallsign[cs].t || 0)) < 60_000,
  );

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
              sondehub.org feed · tracking {callsignList.length} {CALLSIGN_PREFIX.toUpperCase()}-* callsigns
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {callsignList.map((cs) => (
          <CallsignCard key={cs} callsign={cs} data={byCallsign[cs]} />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        Showing cards for {CALLSIGN_CARDS.join(', ').toUpperCase()} plus any other {CALLSIGN_PREFIX.toUpperCase()}-* callsign on the feed
      </div>
    </section>
  );
}
