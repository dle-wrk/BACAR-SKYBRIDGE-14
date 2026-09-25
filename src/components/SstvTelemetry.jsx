import { useEffect, useState } from 'react';
import { AudioLines, Radio, Info, Clock, Mic, Volume2 } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

// External SSTV modes we might hear on-air. Skybridge cubes do NOT emit
// SSTV — this tab is for monitoring third-party transmissions (pico
// balloons, ISS SSTV events, HAMs on the pass, etc.) via a laptop
// audio capture.
const MODES = [
  { id: 'robot36', label: 'Robot 36', seconds: 36, resolution: '320×240', primary: true },
  { id: 'martinm1', label: 'Martin M1', seconds: 114, resolution: '320×256', primary: true },
  { id: 'uhfsstv', label: 'UHF SSTV', seconds: '—', resolution: '—', primary: true, note: 'Robot/Martin over 70 cm' },
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

// Turn a peak-dB reading (typically -60..0) into a 0..1 meter fill.
function peakToBar(peak_db) {
  if (peak_db === undefined || peak_db === null) return 0;
  const min = -60;
  const max = 0;
  const clamped = Math.max(min, Math.min(max, peak_db));
  return (clamped - min) / (max - min);
}

export default function SstvTelemetry() {
  const [, setTick] = useState(0);
  const status = telemetry.getSstvStatus();
  const history = telemetry.getSstvHistory();

  useEffect(() => telemetry.subscribe(() => setTick((tick) => tick + 1)), []);

  const receiverAlive = status && (Date.now() - (status.t || 0)) < 60_000;
  const isReceiver = status?.role === 'receiver' || status?.event === 'captured';

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <AudioLines className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">SSTV Receiver</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              sstv/status · external audio capture
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          receiverAlive
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-border/60 text-muted-foreground'
        }`}>
          {receiverAlive ? 'RECEIVER ONLINE' : 'AWAITING RECEIVER'}
        </span>
      </div>

      {!receiverAlive ? (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="mb-2">
                No SSTV audio receiver is publishing to <code className="font-mono text-xs text-accent">sstv/status</code> yet.
              </p>
              <p className="mb-1 text-xs">Start it on the base-station laptop:</p>
              <pre className="overflow-x-auto rounded-md border border-border/40 bg-background/60 p-2 font-mono text-[11px] text-foreground">
{`# capture what's playing to the speakers (Windows WASAPI loopback)
python ground-station/holocube_sstv_rx.py --broker broker.emqx.io --loopback

# or from a specific input device (e.g. line-in, radio interface)
python ground-station/holocube_sstv_rx.py --broker broker.emqx.io --device "CABLE Output"

# list available devices first
python ground-station/holocube_sstv_rx.py --list-devices`}
              </pre>
              <p className="mt-2 text-xs">
                Rolling 60-second WAV files are saved to <code className="font-mono text-xs">sstv_rx/</code>.
                Feed them into MMSSTV / QSSTV / an online decoder to recover the image.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Note: Skybridge cubes do <em>not</em> transmit SSTV. This tab monitors external sources — pico
                balloons, ISS SSTV events, HAMs on the pass.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Last event" value={timeAgo(status.t)} />
            <Field label="Source" value={status.source || '--'} />
            <Field label="Device" value={status.device || '--'} />
            <Field label="Duration" value={status.duration_s} unit="s" />
            <Field label="Peak" value={status.peak_db} unit="dB" />
            <Field label="Wav bytes" value={status.wav_bytes} />
          </div>

          {isReceiver && status.peak_db != null && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Volume2 className="h-3 w-3" />
                Last capture peak level
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/40">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.round(peakToBar(status.peak_db) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-accent" />
          <h3 className="font-heading text-sm font-semibold">Modes we monitor for</h3>
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
                {m.note ? m.note : `${m.resolution} · ${m.seconds}s per frame`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-accent" />
            <h3 className="font-heading text-sm font-semibold">Recent captures</h3>
          </div>
          <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50">
            {history.slice(0, 8).map((entry, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-muted-foreground shrink-0">{timeAgo(entry.t)}</span>
                  <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">
                    {entry.wav_path ? entry.wav_path.split(/[\\/]/).pop() : (entry.mode || '--')}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-muted-foreground shrink-0">
                  {entry.duration_s && <span>{entry.duration_s}s</span>}
                  {entry.peak_db != null && <span>{entry.peak_db}dB</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
