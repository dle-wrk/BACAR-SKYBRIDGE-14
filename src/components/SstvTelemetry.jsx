import { AudioLines, Radio, Mic, MicOff, Zap, Download, Image as ImageIcon, Clock } from 'lucide-react';
import { useSstvReceiver } from '@/lib/useSstvReceiver';

const MODE_ROWS = [
  { id: 'robot36',   label: 'Robot 36',   seconds: 36,  resolution: '320×240', primary: true,  decodable: true  },
  { id: 'martinm1',  label: 'Martin M1',  seconds: 114, resolution: '320×256', primary: true,  decodable: true  },
  { id: 'uhfsstv',   label: 'UHF SSTV',   seconds: '—', resolution: '—',       primary: true,  note: 'Robot/Martin over 70 cm' },
  { id: 'robot72',   label: 'Robot 72',   seconds: 72,  resolution: '320×240' },
  { id: 'martinm2',  label: 'Martin M2',  seconds: 58,  resolution: '320×256' },
  { id: 'scottieS1', label: 'Scottie S1', seconds: 110, resolution: '320×256' },
];

function timeAgo(t) {
  if (!t) return '--';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function downloadHref(url, filename) {
  return (
    <a
      href={url}
      download={filename}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
    >
      <Download className="h-3 w-3" />
      {filename.endsWith('.wav') ? 'WAV' : 'PNG'}
    </a>
  );
}

export default function SstvTelemetry() {
  const rx = useSstvReceiver();

  const listening   = rx.state === 'listening' || rx.state === 'receiving';
  const receiving   = rx.state === 'receiving';

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
              in-browser · auto-detect from VIS header
            </div>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${
          receiving
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : listening
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-border/60 text-muted-foreground'
        }`}>
          {receiving ? 'RECEIVING…' : listening ? 'LISTENING' : 'IDLE'}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {rx.state === 'idle' || rx.state === 'error' ? (
          <button
            type="button"
            onClick={rx.start}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            <Mic className="h-4 w-4" />
            Start listening
          </button>
        ) : (
          <button
            type="button"
            onClick={rx.stop}
            className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-secondary px-4 py-2 text-sm font-semibold transition hover:border-accent hover:text-accent"
          >
            <MicOff className="h-4 w-4" />
            Stop
          </button>
        )}

        {rx.devices.length > 0 && (
          <select
            value={rx.selectedDeviceId}
            onChange={(e) => rx.setSelectedDeviceId(e.target.value)}
            disabled={listening}
            className="rounded-lg border border-border/60 bg-background/60 px-2 py-2 text-xs font-mono text-foreground disabled:opacity-60"
          >
            <option value="">Default input</option>
            {rx.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Input ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        )}

        {listening && (
          <div className="flex flex-1 min-w-32 items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Level</span>
            <div className="h-2 flex-1 min-w-16 overflow-hidden rounded-full bg-secondary/40">
              <div
                className={`h-full rounded-full transition-all ${
                  rx.audioLevel > 0.95 ? 'bg-red-500' : rx.audioLevel > 0.7 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(100, Math.round(rx.audioLevel * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {rx.error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {rx.error}
        </div>
      )}

      {rx.state === 'idle' && (
        <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <p>
            Click <strong>Start listening</strong> and grant microphone access. The tab will listen
            continuously, auto-detect the mode from every SSTV transmission&apos;s VIS header, decode
            Robot 36 and Martin M1 inline, and let you download the WAV and PNG for anything it catches.
          </p>
          <p className="mt-2 text-xs">
            To hear SSTV from your radio: connect the radio&apos;s audio out to the laptop&apos;s mic in, or
            pick an audio-over-USB interface from the input dropdown after starting.
            To capture what&apos;s playing on the laptop (e.g. an SDR web receiver), install VB-CABLE
            and pick <code className="font-mono">CABLE Output</code> as the input.
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Skybridge cubes do <em>not</em> transmit SSTV. This is for monitoring external sources —
            pico balloons, ISS SSTV events, HAMs on the pass.
          </p>
        </div>
      )}

      {receiving && rx.detected && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
          <Zap className="h-4 w-4 shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-mono uppercase tracking-wider">Now receiving</div>
            <div className="mt-0.5 font-semibold">
              {rx.detected.mode.label}
              {rx.detected.mode.vis && (
                <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono">
                  VIS {rx.detected.mode.vis}
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-xs font-mono text-amber-200/80">
            {rx.detected.mode.seconds}s frame
          </div>
        </div>
      )}

      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-accent" />
          <h3 className="font-heading text-sm font-semibold">Modes we listen for</h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_ROWS.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border px-3 py-2 ${
                m.primary
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-border/60 bg-secondary/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate font-mono text-sm font-semibold">{m.label}</div>
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

      {rx.captures.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-accent" />
            <h3 className="font-heading text-sm font-semibold">Recent captures</h3>
          </div>
          <div className="space-y-3">
            {rx.captures.map((c) => (
              <div key={c.t} className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-mono uppercase text-accent">
                      {c.modeLabel}
                    </span>
                    {c.vis && (
                      <span className="text-[10px] font-mono text-muted-foreground">VIS {c.vis}</span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(c.t)}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{c.seconds}s</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.png && downloadHref(c.png, `sstv_${c.mode}_${c.t}.png`)}
                    {c.wavUrl && downloadHref(c.wavUrl, `sstv_${c.mode}_${c.t}.wav`)}
                  </div>
                </div>
                {c.png ? (
                  <img
                    src={c.png}
                    alt={`${c.modeLabel} capture`}
                    className="max-h-72 rounded-lg border border-border/60"
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-border/60 bg-background/60 p-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-3.5 w-3.5" />
                      No decoder for {c.modeLabel} yet — WAV saved. Decode in MMSSTV / QSSTV.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
