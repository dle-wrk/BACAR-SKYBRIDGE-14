import { useEffect, useState } from 'react';
import { Compass, Navigation, Target, Wifi } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

// Rotator telemetry display — reads whatever the ground station publishes
// to the rotator/telemetry MQTT topic. The dashboard already ingests it via
// telemetry.getRotatorTelemetry(); here we just surface it.
//
// Expected fields on the payload (all optional — show '--' if missing):
//   azimuth / horizontal_angle (deg)
//   elevation / vertical_angle (deg)
//   azimuth_target / elevation_target (deg)
//   tracking_mode (manual / auto / park)
//   frequency / rssi / signal strength

function Stat({ icon: Icon, label, value, unit = '' }) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-bold">
        {value ?? '--'}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

// Simple SVG compass showing azimuth; needle rotates to the az angle.
function Compass2D({ azimuth, target }) {
  const az = Number.isFinite(azimuth) ? azimuth : null;
  const tgt = Number.isFinite(target) ? target : null;
  const needle = (angle, length, color) => {
    if (!Number.isFinite(angle)) return null;
    const r = (angle - 90) * (Math.PI / 180);  // 0° = up (N)
    const x2 = 100 + Math.cos(r) * length;
    const y2 = 100 + Math.sin(r) * length;
    return <line x1={100} y1={100} x2={x2} y2={y2} stroke={color} strokeWidth={3} strokeLinecap="round" />;
  };
  return (
    <svg viewBox="0 0 200 200" width="200" height="200" className="shrink-0">
      <circle cx={100} cy={100} r={88} fill="none" stroke="hsl(225 35% 20%)" strokeWidth={1} />
      <circle cx={100} cy={100} r={70} fill="none" stroke="hsl(225 35% 20%)" strokeWidth={1} strokeDasharray="2 4" />
      {['N', 'E', 'S', 'W'].map((d, i) => {
        const a = (i * 90 - 90) * (Math.PI / 180);
        const x = 100 + Math.cos(a) * 96;
        const y = 100 + Math.sin(a) * 96;
        return <text key={d} x={x} y={y + 4} textAnchor="middle" fontSize="12" fontFamily="ui-monospace" fill={d === 'N' ? '#f87171' : 'hsl(215 25% 65%)'}>{d}</text>;
      })}
      {needle(tgt, 60, '#f59e0b')}
      {needle(az, 80, '#38bdf8')}
      <circle cx={100} cy={100} r={5} fill="#38bdf8" />
      <text x={100} y={190} textAnchor="middle" fontSize="10" fontFamily="ui-monospace" fill="hsl(215 25% 65%)">
        {az !== null ? `${az.toFixed(1)}° az` : 'no fix'}
        {tgt !== null && ` · target ${tgt.toFixed(1)}°`}
      </text>
    </svg>
  );
}

// Elevation gauge: horizon → zenith arc.
function Elevation({ elevation, target }) {
  const el = Number.isFinite(elevation) ? elevation : null;
  const tgt = Number.isFinite(target) ? target : null;
  const toXY = (angle) => {
    const a = (90 - angle) * (Math.PI / 180);  // 0° = horizon (right), 90° = up
    const r = 80;
    return [100 + Math.cos(a) * r, 100 - Math.sin(a) * r];
  };
  return (
    <svg viewBox="0 0 200 110" width="200" height="110" className="shrink-0">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="hsl(225 35% 20%)" strokeWidth={1} />
      {[0, 30, 60, 90].map((a) => {
        const [x, y] = toXY(a);
        return <text key={a} x={x} y={y - 4} textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fill="hsl(215 25% 65%)">{a}°</text>;
      })}
      {tgt !== null && (
        <line x1={100} y1={100} x2={toXY(tgt)[0]} y2={toXY(tgt)[1]} stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" />
      )}
      {el !== null && (
        <line x1={100} y1={100} x2={toXY(el)[0]} y2={toXY(el)[1]} stroke="#38bdf8" strokeWidth={3} strokeLinecap="round" />
      )}
      <circle cx={100} cy={100} r={4} fill="#38bdf8" />
      <line x1={20} y1={100} x2={180} y2={100} stroke="hsl(225 35% 25%)" strokeWidth={1} />
    </svg>
  );
}

export default function RotatorPanel() {
  const [t, setT] = useState(telemetry.getRotatorTelemetry());
  useEffect(() => telemetry.subscribe(() => setT(telemetry.getRotatorTelemetry())), []);

  // Accept either explicit azimuth/elevation or the generic
  // horizontal_angle/vertical_angle names already in the normaliser.
  const azimuth   = Number(t?.azimuth ?? t?.horizontal_angle);
  const elevation = Number(t?.elevation ?? t?.vertical_angle);
  const azTarget  = Number(t?.azimuth_target   ?? t?.az_target);
  const elTarget  = Number(t?.elevation_target ?? t?.el_target);
  const fresh = t && typeof t.t === 'number' && (Date.now() - t.t) < 60_000;

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Compass className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">Antenna Rotator</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              rotator/telemetry · ground-station az/el controller
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          fresh
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-border/60 text-muted-foreground'
        }`}>
          {fresh ? 'LIVE' : t ? 'STALE' : 'AWAITING DATA'}
        </span>
      </div>

      {!t ? (
        <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
          <Target className="mx-auto mb-2 h-5 w-5 opacity-40" />
          Awaiting telemetry on <code className="font-mono text-[11px]">rotator/telemetry</code>.
          <div className="mt-1">The ground station publishes azimuth / elevation / tracking state here.</div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat icon={Navigation} label="Azimuth"    value={Number.isFinite(azimuth)   ? azimuth.toFixed(1)   : '--'} unit="°" />
            <Stat icon={Navigation} label="Elevation"  value={Number.isFinite(elevation) ? elevation.toFixed(1) : '--'} unit="°" />
            <Stat icon={Target}     label="Az target"  value={Number.isFinite(azTarget)  ? azTarget.toFixed(1)  : '--'} unit="°" />
            <Stat icon={Target}     label="El target"  value={Number.isFinite(elTarget)  ? elTarget.toFixed(1)  : '--'} unit="°" />
            <Stat icon={Wifi}       label="Mode"       value={t.tracking_mode || t.mode || '--'} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 rounded-xl border border-border/50 bg-background/40 p-4">
            <div className="flex flex-col items-center gap-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Azimuth</div>
              <Compass2D azimuth={azimuth} target={azTarget} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Elevation</div>
              <Elevation elevation={elevation} target={elTarget} />
            </div>
            <div className="flex flex-col gap-1 text-[10px] font-mono text-muted-foreground">
              <div><span className="inline-block h-2 w-2 rounded-full bg-sky-400 mr-1 align-middle" /> actual</div>
              <div><span className="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1 align-middle" /> target</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
