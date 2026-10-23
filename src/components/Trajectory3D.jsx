import { useMemo, useState } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

const Plot = createPlotlyComponent(Plotly);

const DEFAULT_CAMERA = { eye: { x: 1.4, y: 1.4, z: 0.9 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

/**
 * 3D flight trajectory — lon/lat/altitude, line coloured by altitude.
 * Each viewer rotates / zooms / pans freely on their own screen; the camera
 * is preserved across incoming data updates via Plotly's `uirevision`, and
 * only resets to the default angle when the user clicks "Reset camera".
 *
 * `history` must be an array of { latitude, longitude, altitude_m } points.
 * `label` labels the card header (defaults to "3D Trajectory").
 * `height` lets a caller override the plot height (default 420 px).
 */
export default function Trajectory3D({ history, label = '3D Trajectory', height = 420 }) {
  const [cameraRev, setCameraRev] = useState(0);
  const points = useMemo(
    () => (history || []).filter((h) =>
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
          {label} · altitude vs lat/lon
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
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label} · {points.length} fixes · peak {(peak.altitude_m / 1000).toFixed(2)} km
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCameraRev((n) => n + 1)}
            title="Reset camera to default view"
            className="rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[10px] font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent"
          >
            Reset camera
          </button>
          <span className="text-[10px] font-mono text-muted-foreground">drag · scroll · hover</span>
        </div>
      </div>
      <div style={{ height }}>
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
              camera: DEFAULT_CAMERA,
              bgcolor: 'rgba(0,0,0,0)',
              uirevision: `cam-${cameraRev}`,
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
