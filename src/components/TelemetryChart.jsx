import { useMemo } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';

// Altitude / vertical-speed chart for a single cube's history.
export default function TelemetryChart({ history, metric = 'altitude_m', color = '#38bdf8', label = 'Altitude (m)', height = 200 }) {
  const data = useMemo(
    () =>
      (history || [])
        .filter((h) => h[metric] != null)
        .map((h) => ({ t: h.t, v: h[metric] })),
    [history, metric]
  );

  if (data.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-muted-foreground">
        Collecting telemetry…
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.v));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          tick={{ fill: 'hsl(215 25% 65%)', fontSize: 10 }}
          stroke="hsl(225 35% 20%)"
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: 'hsl(215 25% 65%)', fontSize: 10 }}
          stroke="hsl(225 35% 20%)"
          width={48}
          tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(226 47% 7%)',
            border: '1px solid hsl(225 35% 20%)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(t) => new Date(t).toLocaleTimeString()}
          formatter={(v) => [`${v}`, label]}
        />
        <ReferenceLine y={max} stroke={color} strokeDasharray="3 3" strokeOpacity={0.3} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#g-${metric})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}