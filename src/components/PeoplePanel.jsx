import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Users, Download, Globe, Clock, Trash2 } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';

// Reuse the Leaflet default-icon fix from LuminaDetail (shared across the app).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function timeAgo(t) {
  if (!t) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default function PeoplePanel() {
  const [, setTick] = useState(0);
  useEffect(() => telemetry.subscribe(() => setTick((n) => n + 1)), []);

  const online = telemetry.getPresence();
  const history = telemetry.getPresenceHistory();

  // Only online users with coordinates land on the map.
  const mapped = useMemo(
    () => online.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number'),
    [online],
  );
  const center = mapped.length > 0 ? [mapped[0].lat, mapped[0].lon] : [-26.2, 28.0]; // Johannesburg default

  const handleBackup = () => {
    telemetry.downloadPresenceBackup();
  };
  const handleClear = () => {
    if (!window.confirm('Clear the Who\'s Watching history? Online now stays; only the 5-day rolling log is wiped.')) return;
    telemetry.clearPresenceHistory();
  };

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-heading font-semibold">Who&apos;s Watching</h2>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              presence over MQTT · 5-day rolling history
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono uppercase text-emerald-300">
            {online.length} online
          </span>
          <button
            type="button"
            onClick={handleBackup}
            title="Download the 5-day presence history as JSON. Also fires automatically every 5 days."
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            <Download className="h-3.5 w-3.5" />
            Backup
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Wipe the 5-day rolling log on this device. Online now is unaffected."
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs font-mono uppercase text-muted-foreground transition hover:border-red-500/60 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-border/50">
          <div className="border-b border-border/50 bg-background/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Globe className="mr-1 inline h-3 w-3" /> Viewer locations · {mapped.length} on map
          </div>
          <div style={{ height: 280 }}>
            <MapContainer
              center={center}
              zoom={mapped.length > 1 ? 3 : 7}
              scrollWheelZoom
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {mapped.map((p) => (
                <Marker key={p.sessionId} position={[p.lat, p.lon]}>
                  <Popup>
                    <div className="font-mono text-xs">
                      <div><strong>{p.sender}</strong></div>
                      {p.location && <div>{p.location}</div>}
                      <div>Joined {timeAgo(p.joinedAt)}</div>
                      <div>Last seen {timeAgo(p.lastSeen)}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Online now + Recent joins list */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Online now
            </div>
            {online.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">Just you.</div>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {online.slice(0, 10).map((p) => (
                  <li key={p.sessionId} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 live-dot" />
                      <span className="truncate font-mono font-semibold">{p.sender}</span>
                      {p.location && <span className="truncate text-muted-foreground">· {p.location}</span>}
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{timeAgo(p.joinedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border/50 bg-background/40 p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span><Clock className="mr-1 inline h-3 w-3" /> Recent joins (5-day)</span>
              <span>{history.length} total</span>
            </div>
            {history.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">No joins yet.</div>
            ) : (
              <ul className="space-y-1 text-xs">
                {history.slice(0, 10).map((e, i) => (
                  <li key={`${e.sessionId}:${e.t}:${i}`} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="truncate font-mono font-semibold">{e.sender}</span>
                      {e.location && <span className="ml-1 text-muted-foreground">· {e.location}</span>}
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{timeAgo(e.t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-muted-foreground">
        Ham observers with a Maidenhead grid are placed on the map automatically; other viewers appear in the
        online list only. History is kept for 5 days on this device, then auto-exported as JSON.
      </div>
    </section>
  );
}
