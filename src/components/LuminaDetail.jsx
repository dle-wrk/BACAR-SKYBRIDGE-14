import { useEffect, useMemo, useState } from 'react';
import { Mountain, TrendingUp, TrendingDown, Thermometer, Gauge, Droplets, MapPin, Clock, Radio } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { telemetry } from '@/lib/mqttService';

// Fix default marker icons (Vite doesn't bundle Leaflet's default PNGs).
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const UTC_OFFSET_HOURS = 2; // Johannesburg / SAST

function formatTimes(ms) {
  if (!ms) return { utc: '--', local: '--' };
  const utc = new Date(ms).toISOString().split('T')[1].replace('Z', '').slice(0, 8);
  const localDate = new Date(ms + UTC_OFFSET_HOURS * 3600_000);
  const local = localDate.toISOString().split('T')[1].replace('Z', '').slice(0, 8);
  return { utc, local };
}

function Stat({ icon: Icon, label, value, unit }) {
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

function Graph({ title, data, dataKey, unit = '', color = '#38bdf8' }) {
  const visible = data.filter((d) => typeof d[dataKey] === 'number' && Number.isFinite(d[dataKey]));
  if (visible.length < 2) {
    return (
      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="py-8 text-center text-xs text-muted-foreground">Collecting history…</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {visible[visible.length - 1][dataKey]} {unit}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={visible} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid stroke="hsl(225 35% 20%)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            tick={{ fill: 'hsl(215 25% 65%)', fontSize: 10 }}
            stroke="hsl(225 35% 20%)"
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: 'hsl(215 25% 65%)', fontSize: 10 }}
            stroke="hsl(225 35% 20%)"
            width={48}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(226 47% 7%)',
              border: '1px solid hsl(225 35% 20%)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) => new Date(t).toLocaleTimeString()}
            formatter={(v) => [`${v} ${unit}`, title]}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function LuminaDetail({ cube }) {
  const [, setTick] = useState(0);
  useEffect(() => telemetry.subscribe(() => setTick((t) => t + 1)), []);

  const t = cube.telemetry;
  const history = cube.history || [];

  // Every packet with coordinates — plotted on the map.
  const trackPoints = useMemo(
    () => history
      .filter((h) => typeof h.latitude === 'number' && typeof h.longitude === 'number')
      .map((h) => ({ lat: h.latitude, lon: h.longitude, t: h.t, alt: h.altitude_m })),
    [history],
  );

  const climbing = t && typeof t.vertical_speed_ms === 'number' && t.vertical_speed_ms >= 0;
  const times = formatTimes(t?.t);
  const maxAlt = history.length ? Math.max(...history.map((h) => h.altitude_m || 0)) : 0;

  const mapCenter = trackPoints.length
    ? [trackPoints[trackPoints.length - 1].lat, trackPoints[trackPoints.length - 1].lon]
    : [cube.profile?.startLat ?? 0, cube.profile?.startLon ?? 0];

  return (
    <section className="strat-card rounded-2xl border border-border/60 p-4 sm:p-5 mb-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${t ? 'bg-emerald-400 live-dot' : 'bg-muted-foreground'}`} />
            <span className="font-mono text-xs text-muted-foreground">{cube.id}</span>
          </div>
          <h2 className="mt-0.5 font-heading text-xl font-bold sm:text-2xl">{cube.name}</h2>
        </div>
        {t && (
          <div className="text-right text-[10px] font-mono text-muted-foreground">
            <div className="flex items-center justify-end gap-1.5">
              <Clock className="h-3 w-3" /> UTC {times.utc}
            </div>
            <div className="flex items-center justify-end gap-1.5 opacity-70">
              Local (+2) {times.local}
            </div>
          </div>
        )}
      </div>

      {!t ? (
        <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          <Radio className="mx-auto mb-2 h-5 w-5 opacity-40" />
          Awaiting telemetry on <code className="font-mono text-xs">{cube.telemetryTopic}</code>…
        </div>
      ) : (
        <>
          {/* Hero stats */}
          <div className="mb-4 flex flex-wrap items-end gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Altitude</div>
              <div className="font-mono text-4xl font-bold strat-glow text-accent">
                {(Number(t.altitude_m || 0) / 1000).toFixed(2)}
              </div>
              <div className="-mt-0.5 text-[10px] text-muted-foreground">kilometres</div>
            </div>
            <div className="flex flex-col gap-1">
              <span className={`flex items-center gap-1 font-mono text-sm ${climbing ? 'text-sky-400' : 'text-amber-400'}`}>
                {climbing ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {typeof t.vertical_speed_ms === 'number'
                  ? `${t.vertical_speed_ms >= 0 ? '+' : ''}${t.vertical_speed_ms} m/s`
                  : '— m/s'}
              </span>
              {maxAlt > 0 && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  <Mountain className="h-3 w-3" /> peak {(maxAlt / 1000).toFixed(2)} km
                </span>
              )}
            </div>
          </div>

          {/* Field grid */}
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={Thermometer} label="Temp"      value={t.temperature_c?.toFixed?.(1) ?? t.temperature_c} unit="°C" />
            <Stat icon={Gauge}       label="Pressure"  value={t.pressure_hpa?.toFixed?.(0)  ?? t.pressure_hpa}  unit="hPa" />
            <Stat icon={Droplets}    label="Humidity"  value={t.humidity_pct?.toFixed?.(0)  ?? t.humidity ?? '--'} unit="%" />
            <Stat icon={TrendingUp}  label="Speed"     value={t.speed_ms ?? t.ground_speed ?? '--'} unit="m/s" />
            <Stat icon={MapPin}      label="Latitude"  value={t.latitude?.toFixed?.(5)  ?? t.latitude} />
            <Stat icon={MapPin}      label="Longitude" value={t.longitude?.toFixed?.(5) ?? t.longitude} />
          </div>

          {/* Map */}
          <div className="mb-5 overflow-hidden rounded-xl border border-border/50">
            <div className="border-b border-border/50 bg-background/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              GPS track · {trackPoints.length} packet{trackPoints.length === 1 ? '' : 's'}
            </div>
            <div style={{ height: 320 }}>
              <MapContainer
                center={mapCenter}
                zoom={9}
                scrollWheelZoom
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {trackPoints.length > 1 && (
                  <Polyline
                    positions={trackPoints.map((p) => [p.lat, p.lon])}
                    pathOptions={{ color: '#38bdf8', weight: 2, opacity: 0.8 }}
                  />
                )}
                {trackPoints.length > 0 && (
                  <Marker position={[trackPoints[trackPoints.length - 1].lat, trackPoints[trackPoints.length - 1].lon]}>
                    <Popup>
                      <div className="font-mono text-xs">
                        <div><strong>{cube.id}</strong></div>
                        <div>Lat: {trackPoints[trackPoints.length - 1].lat.toFixed(5)}</div>
                        <div>Lon: {trackPoints[trackPoints.length - 1].lon.toFixed(5)}</div>
                        <div>Alt: {trackPoints[trackPoints.length - 1].alt ?? '--'} m</div>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
          </div>

          {/* Graphs */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Graph title="Altitude"     data={history} dataKey="altitude_m"        unit="m"     color="#38bdf8" />
            <Graph title="Speed"        data={history} dataKey="speed_ms"          unit="m/s"   color="#a78bfa" />
            <Graph title="Vert. speed"  data={history} dataKey="vertical_speed_ms" unit="m/s"   color="#f59e0b" />
            <Graph title="Temperature"  data={history} dataKey="temperature_c"     unit="°C"    color="#f87171" />
            <Graph title="Pressure"     data={history} dataKey="pressure_hpa"      unit="hPa"   color="#34d399" />
            <Graph title="Humidity"     data={history} dataKey="humidity_pct"      unit="%"     color="#60a5fa" />
          </div>
        </>
      )}
    </section>
  );
}
