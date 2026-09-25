import { useEffect, useState } from 'react';
import { AudioLines, Radio, Info, Clock } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

// Modes the ground-station bridge (ground-station/holocube_sstv.py) can emit.
// The three the mission plans to use are marked as "primary".
const MODES = [
  { id: 'robot36', label: 'Robot 36', seconds: 36, resolution: '320×240', primary: true },
  { id: 'martinm1', label: 'Martin M1', seconds: 114, resolution: '320×256', primary: true },
  { id: 'robot72', label: 'Robot 72', seconds: 72, resolution: '320×240' },
  { id: 'scottieS1', label: 'Scottie S1', seconds: 110, resolution: '320×256' },
  { id: 'pasokonP3', label: 'Pasokon P3', seconds: 203, resolution: '640×496' },
];

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

function timeAgo(t) {
  if (!t) return '--';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export default function SstvTelemetry() {
  const [, setTick] = useState(0);
  const status = telemetry.getSstvStatus();
  const history = telemetry.getSstvHistory();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  const bridgeAlive = status && (Date.now() - (status.t || 0)) < 60_000;

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <AudioLines className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">SSTV Bridge</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              sstv/status · ground-station encoder
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          bridgeAlive
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-border/60 text-muted-foreground'
        }`}>
          {bridgeAlive ? 'BRIDGE ONLINE' : 'AWAITING BRIDGE'}
        </span>
      </div>

      {!bridgeAlive ? (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="mb-2">
                No SSTV bridge is publishing to <code className="font-mono text-xs text-accent">sstv/status</code> yet.
              </p>
              <p className="mb-1 text-xs">Start it on the base-station laptop:</p>
              <pre className="overflow-x-auto rounded-md border border-border/40 bg-background/60 p-2 font-mono text-[11px] text-foreground">
python ground-station/holocube_sstv.py --broker broker.emqx.io --play
              </pre>
              <p className="mt-2 text-xs">
                It subscribes to every cube image topic, encodes each JPEG as SSTV audio, and plays the .wav
                through your default audio device (route via VB-CABLE to a radio TX).
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Last event" value={timeAgo(status.t)} />
          <Field label="Mode" value={status.mode || '--'} />
          <Field label="Cube" value={status.cube_id || status.cube} />
          <Field label="Duration" value={status.duration_s} unit="s" />
          <Field label="Image bytes" value={status.image_bytes} />
          <Field label="Wav bytes" value={status.wav_bytes} />
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-accent" />
          <h3 className="font-heading text-sm font-semibold">Encoder modes</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODES.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border px-3 py-2 ${
                m.primary
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-border/60 bg-secondary/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-sm font-semibold">{m.label}</div>
                {m.primary && (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-accent">
                    primary
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {m.resolution} · {m.seconds}s per frame
              </div>
            </div>
          ))}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-accent" />
            <h3 className="font-heading text-sm font-semibold">Recent transmissions</h3>
          </div>
          <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50">
            {history.slice(0, 8).map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-muted-foreground">{timeAgo(entry.t)}</span>
                  <span className="font-mono font-semibold">{entry.mode || '--'}</span>
                  <span className="text-muted-foreground">{entry.cube_id || entry.cube || 'unknown'}</span>
                </div>
                <span className="font-mono text-muted-foreground">
                  {entry.duration_s ? `${entry.duration_s}s` : entry.wav_bytes ? `${entry.wav_bytes} B` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
