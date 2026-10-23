import { useEffect, useMemo, useState } from 'react';
import { Mountain, TrendingUp, TrendingDown, Thermometer, Gauge, Droplets, MapPin, Clock, Radio, ChevronDown, ChevronRight } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import { telemetry } from '@/lib/mqttService';

// Full plotly bundle so we get both the 2D line charts and the 3D
// trajectory scatter3d (gl3d module) in one place.
const Plot = createPlotlyComponent(Plotly);

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

// Group every known telemetry field by sensor family. Any key the live packet
// carries that isn't listed below falls into "Other", so new fields show up
// without a code change.
const FIELD_GROUPS = [
  { title: 'GPS',          keys: ['latitude', 'longitude', 'altitude_m', 'gps_altitude_m', 'speed_ms', 'gps_speed_m_s', 'heading_deg', 'gps_course_deg', 'gps_satellites', 'gps_mode', 'gps_valid', 'gps_3d'] },
  { title: 'Environment',  keys: ['temperature_c', 'humidity', 'humidity_pct', 'pressure_hpa', 'bmp_temp_c', 'bmp_pressure_hpa', 'icm_temp_c', 'vertical_speed_ms'] },
  { title: 'Light / UV',   keys: ['tsl_full', 'tsl_ir', 'tsl_visible', 'tsl_lux', 'ltr_light_raw', 'ltr_uv_raw', 'ltr_lux', 'ltr_uv_index'] },
  { title: 'Air quality',  keys: ['sgp40_raw'] },
  { title: 'IMU',          keys: ['accel_x_g', 'accel_y_g', 'accel_z_g', 'gyro_x_dps', 'gyro_y_dps', 'gyro_z_dps', 'mag_x_ut', 'mag_y_ut', 'mag_z_ut'] },
  { title: 'Power',        keys: ['battery_v', 'battery_current_ma'] },
  { title: 'Link',         keys: ['rssi_dbm', 'snr_db', 'gateway_received_count', 'uploader'] },
  { title: 'Housekeeping', keys: ['protocol_version', 'sequence', 'rpi_runtime_s', 'utc_unix_s', 'status', 'sensor_ok', 'errors', 't'] },
];
// Keys handled explicitly in the hero / stat grid — hide from the raw panel
// so it's additive, not a duplicate of what's already on screen above.
const HERO_KEYS = new Set(['altitude_m', 'temperature_c', 'pressure_hpa', 'humidity', 'humidity_pct', 'speed_ms', 'latitude', 'longitude', 'vertical_speed_ms']);

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    // Short integers stay as-is; floats trim to 3 dp.
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function RawTelemetry({ t }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    if (!t || typeof t !== 'object' || Object.keys(t).length === 0) {
      // No packet yet — surface the whole schema so viewers see what's coming.
      return FIELD_GROUPS
        .map((g) => ({ title: g.title, rows: g.keys.filter((k) => !HERO_KEYS.has(k)).map((k) => [k, undefined]) }))
        .filter((g) => g.rows.length > 0);
    }
    const seen = new Set(HERO_KEYS);
    const result = FIELD_GROUPS.map((g) => {
      const rows = g.keys
        .filter((k) => !HERO_KEYS.has(k) && t[k] !== undefined)
        .map((k) => { seen.add(k); return [k, t[k]]; });
      return { title: g.title, rows };
    }).filter((g) => g.rows.length > 0);
    const other = Object.entries(t)
      .filter(([k]) => !seen.has(k) && !FIELD_GROUPS.some((g) => g.keys.includes(k)))
      .sort(([a], [b]) => a.localeCompare(b));
    if (other.length) result.push({ title: 'Other', rows: other });
    return result;
  }, [t]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div className="mt-5 rounded-xl border border-border/50 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          All telemetry fields
        </span>
        <span className="font-mono">{total} fields · live</span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-border/50 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title} className="rounded-lg border border-border/40 bg-secondary/20 p-2">
              <div className="mb-1.5 text-[9px] uppercase tracking-wider text-accent">{g.title}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                {g.rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="truncate text-muted-foreground" title={k}>{k}</dt>
                    <dd className="truncate text-right text-foreground" title={formatValue(v)}>{formatValue(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared Plotly config — dark theme, draggable/zoomable, no watermark.
const PLOT_CONFIG = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines'],
  displayModeBar: 'hover',
};
const PLOT_LAYOUT_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10, color: 'hsl(215 25% 65%)' },
  margin: { l: 50, r: 16, t: 8, b: 32 },
  xaxis: {
    type: 'date',
    gridcolor: 'hsl(225 35% 20%)',
    linecolor: 'hsl(225 35% 20%)',
    tickfont: { size: 10, color: 'hsl(215 25% 65%)' },
    showspikes: true,
    spikemode: 'across',
    spikethickness: 1,
    spikecolor: 'hsl(215 25% 45%)',
    spikedash: 'dot',
  },
  yaxis: {
    gridcolor: 'hsl(225 35% 20%)',
    linecolor: 'hsl(225 35% 20%)',
    tickfont: { size: 10, color: 'hsl(215 25% 65%)' },
    zeroline: false,
  },
  hoverlabel: {
    bgcolor: 'hsl(226 47% 7%)',
    bordercolor: 'hsl(225 35% 20%)',
    font: { size: 11, color: '#e2e8f0', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  },
  showlegend: false,
};

// 3D flight trajectory — lon / lat / altitude, line coloured by altitude so
// the burst point (peak) and descent read instantly. Drag to rotate, scroll
// to zoom, hover for altitude/time at any point.
function Trajectory3D({ history }) {
  const points = useMemo(
    () => history.filter((h) =>
      typeof h.latitude === 'number' && Number.isFinite(h.latitude) &&
      typeof h.longitude === 'number' && Number.isFinite(h.longitude) &&
      typeof h.altitude_m === 'number' && Number.isFinite(h.altitude_m),
    ),
    [history],
  );
  if (points.length < 2) {
    return (
      <div className="mb-5 rounded-xl border border-border/50 bg-background/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          3D Trajectory · altitude vs lat/lon
        </div>
        <div className="py-10 text-center text-xs text-muted-foreground">
          Collecting GPS fixes… need at least two with coordinates + altitude.
        </div>
      </div>
    );
  }
  const trace = {
    type: 'scatter3d',
    mode: 'lines+markers',
    x: points.map((p) => p.longitude),
    y: points.map((p) => p.latitude),
    z: points.map((p) => p.altitude_m / 1000),
    line: { width: 4, color: points.map((p) => p.altitude_m / 1000), colorscale: 'Viridis', showscale: true,
            colorbar: { title: { text: 'km', font: { color: 'hsl(215 25% 65%)', size: 10 } }, tickfont: { color: 'hsl(215 25% 65%)', size: 9 }, thickness: 10, len: 0.7 } },
    marker: { size: 2, color: points.map((p) => p.altitude_m / 1000), colorscale: 'Viridis', opacity: 0.85 },
    hovertemplate: 'lat %{y:.4f}<br>lon %{x:.4f}<br>alt %{z:.2f} km<extra></extra>',
    name: 'Trajectory',
  };
  const peak = points.reduce((m, p) => (p.altitude_m > (m?.altitude_m ?? -Infinity) ? p : m), points[0]);
  const peakMarker = {
    type: 'scatter3d', mode: 'markers',
    x: [peak.longitude], y: [peak.latitude], z: [peak.altitude_m / 1000],
    marker: { size: 6, color: '#f59e0b', symbol: 'diamond', line: { color: '#111', width: 1 } },
    hovertemplate: `Peak ${(peak.altitude_m / 1000).toFixed(2)} km<extra></extra>`,
    name: 'Peak',
    showlegend: false,
  };
  const latest = points[points.length - 1];
  const latestMarker = {
    type: 'scatter3d', mode: 'markers',
    x: [latest.longitude], y: [latest.latitude], z: [latest.altitude_m / 1000],
    marker: { size: 6, color: '#38bdf8', symbol: 'circle', line: { color: '#111', width: 1 } },
    hovertemplate: `Latest ${(latest.altitude_m / 1000).toFixed(2)} km<extra></extra>`,
    name: 'Latest',
    showlegend: false,
  };
  const axisStyle = {
    gridcolor: 'hsl(225 35% 20%)',
    zerolinecolor: 'hsl(225 35% 25%)',
    tickfont: { color: 'hsl(215 25% 65%)', size: 9 },
    titlefont: { color: 'hsl(215 25% 65%)', size: 10 },
    backgroundcolor: 'rgba(0,0,0,0)',
    showbackground: true,
  };
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-border/50 bg-background/40">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          3D Trajectory · {points.length} fixes · peak {(peak.altitude_m / 1000).toFixed(2)} km
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">drag · scroll · hover</div>
      </div>
      <div style={{ height: 420 }}>
        <Plot
          data={[trace, peakMarker, latestMarker]}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            margin: { l: 0, r: 0, t: 0, b: 0 },
            scene: {
              xaxis: { ...axisStyle, title: { text: 'Longitude' } },
              yaxis: { ...axisStyle, title: { text: 'Latitude'  } },
              zaxis: { ...axisStyle, title: { text: 'Altitude (km)' } },
              aspectmode: 'auto',
              camera: { eye: { x: 1.4, y: 1.4, z: 0.9 } },
              bgcolor: 'rgba(0,0,0,0)',
            },
            hoverlabel: {
              bgcolor: 'hsl(226 47% 7%)', bordercolor: 'hsl(225 35% 20%)',
              font: { size: 11, color: '#e2e8f0', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            },
            showlegend: false,
          }}
          config={{ displaylogo: false, responsive: true, displayModeBar: 'hover' }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}

function Graph({ title, data, dataKey, unit = '', color = '#38bdf8' }) {
  const visible = useMemo(
    () => data.filter((d) => typeof d[dataKey] === 'number' && Number.isFinite(d[dataKey])),
    [data, dataKey],
  );
  const latest = visible.length ? visible[visible.length - 1][dataKey] : null;

  if (visible.length < 2) {
    return (
      <div className="rounded-xl border border-border/50 bg-background/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="py-8 text-center text-xs text-muted-foreground">Collecting history…</div>
      </div>
    );
  }

  const trace = {
    x: visible.map((d) => new Date(d.t)),
    y: visible.map((d) => d[dataKey]),
    type: 'scatter',
    mode: 'lines',
    line: { color, width: 2, shape: 'spline', smoothing: 0.6 },
    fill: 'tozeroy',
    fillcolor: `${color}18`,  // ~9% alpha hex
    hovertemplate: `%{y} ${unit}<br>%{x|%H:%M:%S}<extra></extra>`,
    name: title,
  };

  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {Number.isFinite(latest) ? (Number.isInteger(latest) ? latest : latest.toFixed(2)) : '--'} {unit}
        </div>
      </div>
      <Plot
        data={[trace]}
        layout={{ ...PLOT_LAYOUT_BASE, height: 180 }}
        config={PLOT_CONFIG}
        useResizeHandler
        style={{ width: '100%', height: 180 }}
      />
    </div>
  );
}

export default function LuminaDetail({ cube }) {
  const [, setTick] = useState(0);
  useEffect(() => telemetry.subscribe(() => setTick((t) => t + 1)), []);

  const hasT = !!cube.telemetry;
  const t = cube.telemetry || {};
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
            <span className={`h-1.5 w-1.5 rounded-full ${hasT ? 'bg-emerald-400 live-dot' : 'bg-muted-foreground'}`} />
            <span className="font-mono text-xs text-muted-foreground">{cube.id}</span>
          </div>
          <h2 className="mt-0.5 font-heading text-xl font-bold sm:text-2xl">{cube.name}</h2>
        </div>
        {hasT && (
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

      {!hasT && (
        <div className="mb-4 rounded-xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          <Radio className="mx-auto mb-2 h-5 w-5 opacity-40" />
          No telemetry on <code className="font-mono text-[11px]">{cube.telemetryTopic}</code> yet — fields below show the structure.
        </div>
      )}
      {hasT && typeof t.t === 'number' && (Date.now() - t.t) > 60_000 && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[10px] font-mono uppercase text-amber-300">
          Stale · last packet {Math.round((Date.now() - t.t) / 60_000)} min ago
        </div>
      )}
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

          {/* 3D flight trajectory */}
          <Trajectory3D history={history} />

          {/* Graphs */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Graph title="Altitude"     data={history} dataKey="altitude_m"        unit="m"     color="#38bdf8" />
            <Graph title="Speed"        data={history} dataKey="speed_ms"          unit="m/s"   color="#a78bfa" />
            <Graph title="Vert. speed"  data={history} dataKey="vertical_speed_ms" unit="m/s"   color="#f59e0b" />
            <Graph title="Temperature"  data={history} dataKey="temperature_c"     unit="°C"    color="#f87171" />
            <Graph title="Pressure"     data={history} dataKey="pressure_hpa"      unit="hPa"   color="#34d399" />
            <Graph title="Humidity"     data={history} dataKey="humidity_pct"      unit="%"     color="#60a5fa" />
          </div>

          {/* Raw dump — every field on the live packet, auto-updating. */}
          <RawTelemetry t={t} />
      </>
    </section>
  );
}
