import { useEffect, useState } from 'react';
import { AudioLines, Radio, Info, Clock, Mic, ImageIcon, Zap } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

const MODES = [
  { id: 'robot36',   label: 'Robot 36',   seconds: 36,  resolution: '320×240', primary: true,  decodable: true  },
  { id: 'martinm1',  label: 'Martin M1',  seconds: 114, resolution: '320×256', primary: true,  decodable: true  },
  { id: 'uhfsstv',   label: 'UHF SSTV',   seconds: '—', resolution: '—',       primary: true,  note: 'Robot/Martin over 70 cm' },
  { id: 'robot72',   label: 'Robot 72',   seconds: 72,  resolution: '320×240' },
  { id: 'martinm2',  label: 'Martin M2',  seconds: 58,  resolution: '320×256' },
  { id: 'scottieS1', label: 'Scottie S1', seconds: 110, resolution: '320×256' },
  { id: 'scottieS2', label: 'Scottie S2', seconds: 71,  resolution: '320×256' },
  { id: 'pd120',     label: 'PD 120',     seconds: 120, resolution: '640×496' },
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

  const receiverAlive = status && (Date.now() - (status.t || 0)) < 120_000;
  const currentlyReceiving = status?.event === 'detected';
  const lastCapture = history.find((e) => e.event === 'captured' || e.status === 'captured');
  const thumb = lastCapture?.thumbnail;

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
              sstv/status · auto-detect from VIS header
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          currentlyReceiving
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : receiverAlive
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-border/60 text-muted-foreground'
        }`}>
          {currentlyReceiving ? 'RECEIVING…' : receiverAlive ? 'RECEIVER ONLINE' : 'AWAITING RECEIVER'}
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

# or a specific input device (e.g. an audio-over-USB radio interface)
python ground-station/holocube_sstv_rx.py --broker broker.emqx.io --device "CABLE Output"

# list all devices
python ground-station/holocube_sstv_rx.py --list-devices`}
              </pre>
              <p className="mt-2 text-xs">
                The receiver listens continuously. When it hears an SSTV transmission start, it reads the
                mode out of the VIS header, records the full frame, saves the WAV, and — for Robot 36 and
                Martin M1 — also decodes the image to PNG. Other modes save a WAV that MMSSTV / QSSTV can
                decode.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Skybridge cubes do <em>not</em> transmit SSTV. This tab monitors external sources — pico
                balloons, ISS SSTV events, HAMs on the pass.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {currentlyReceiving && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
              <Zap className="h-4 w-4 shrink-0 animate-pulse" />
              <div className="min-w-0">
                <div className="text-xs font-mono uppercase tracking-wider">Now receiving</div>
                <div className="mt-0.5 font-semibold">
                  {status.mode_label || status.mode || 'SSTV signal'}
                  {status.vis && (
                    <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono">
                      VIS {status.vis}
                    </span>
                  )}
                </div>
              </div>
              <div className="ml-auto text-right text-xs font-mono text-amber-200/80">
                {status.seconds ? `${status.seconds}s frame` : ''}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Last event" value={timeAgo(status.t)} />
            <Field label="Mode" value={status.mode_label || status.mode || '--'} />
            <Field label="VIS" value={status.vis} />
            <Field label="Source" value={status.source || '--'} />
            <Field label="Device" value={status.device || '--'} />
            <Field label="Duration" value={status.duration_s || status.seconds} unit="s" />
          </div>

          {thumb && (
            <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                Last decoded image · {lastCapture.mode_label || lastCapture.mode}
              </div>
              <img
                src={thumb}
                alt={`Decoded SSTV frame (${lastCapture.mode_label || lastCapture.mode})`}
                className="max-h-64 rounded-lg border border-border/60"
              />
              {lastCapture.image_path && (
                <div className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">
                  {lastCapture.image_path}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-accent" />
          <h3 className="font-heading text-sm font-semibold">Modes we listen for</h3>
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
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm font-semibold flex-1 truncate">{m.label}</div>
                {m.primary && (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-accent">
                    primary
                  </span>
                )}
                {m.decodable && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-emerald-300">
                    decoded
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
            {history.slice(0, 8).map((entry, i) => {
              const isCap = entry.event === 'captured' || entry.status === 'captured';
              return (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono text-muted-foreground shrink-0 w-16">{timeAgo(entry.t)}</span>
                    {entry.image_path ? (
                      <ImageIcon className="h-3 w-3 shrink-0 text-emerald-300" />
                    ) : (
                      <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-mono">
                      {entry.mode_label || entry.mode || (entry.wav_path ? entry.wav_path.split(/[\\/]/).pop() : '--')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-muted-foreground shrink-0">
                    {isCap && entry.vis && <span>{entry.vis}</span>}
                    {entry.duration_s && <span>{entry.duration_s}s</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
