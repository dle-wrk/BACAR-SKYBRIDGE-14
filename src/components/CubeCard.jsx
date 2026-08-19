import { useEffect, useState } from 'react';
import { telemetry } from '@/lib/mqttService';
import { ArrowUpRight, Mountain, TrendingUp, TrendingDown, Battery, Thermometer, Gauge, Radio as RadioIcon } from 'lucide-react';

const PHASE_META = {
  ascent: { label: 'Ascending', cls: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  descent: { label: 'Descending', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  landed: { label: 'Landed', cls: 'text-muted-foreground bg-secondary' },
};

function Stat({ icon: Icon, label, value, unit }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/40">
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div className="leading-tight min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-mono text-xs font-semibold truncate">
          {value}<span className="text-muted-foreground font-normal ml-0.5">{unit}</span>
        </div>
      </div>
    </div>
  );
}

export default function CubeCard({ cube, onOpen }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = telemetry.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  const t = cube.telemetry;
  const isNrfOnly = cube.mode === 'nrf_image_only';
  const isRadioOnly = cube.mode === 'radio_battery_only';
  const phase = PHASE_META[t?.phase] || PHASE_META.landed;
  const climbing = t && typeof t.vertical_speed_ms === 'number' && t.vertical_speed_ms >= 0;
  const maxAlt = cube.history.length ? Math.max(...cube.history.map((h) => h.altitude_m || 0)) : 0;
  const ageMs = t ? Date.now() - t.t : null;
  const fresh = ageMs !== null && ageMs < 15000;

  return (
    <button
      onClick={() => onOpen(cube.id)}
      className="group text-left strat-card rounded-2xl p-4 sm:p-5 border border-border/60 hover:border-accent/40 hover:strat-ring-glow transition-all duration-300 w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${fresh ? 'bg-emerald-400 live-dot' : 'bg-muted-foreground'}`} />
            <span className="font-mono text-xs text-muted-foreground">{cube.id}</span>
          </div>
          <h3 className="font-heading font-semibold text-lg mt-0.5">{cube.name}</h3>
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border ${phase.cls}`}>
          {phase.label}
        </span>
      </div>

      {!t ? (
        <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
          <div className="text-center">
            <RadioIcon className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Awaiting telemetry…
          </div>
        </div>
      ) : isNrfOnly ? (
        <>
          <div className="mb-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">nRF link</div>
            <div className="font-mono text-2xl font-bold text-accent mt-1">{t.nrf_rssi_dbm ?? '--'} dBm</div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Stat icon={RadioIcon} label="Signal" value={t.nrf_rssi_dbm ?? '--'} unit="dBm" />
            <Stat icon={ArrowUpRight} label="Frames" value={cube.images?.length ?? 0} unit="img" />
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
            <span className="font-mono text-[10px] text-muted-foreground">Imagery-only payload</span>
            <span className="flex items-center gap-1 text-xs text-accent opacity-70 group-hover:opacity-100 transition">
              View <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      ) : isRadioOnly ? (
        <>
          <div className="mb-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cross-band comms</div>
            <div className="font-mono text-2xl font-bold text-accent mt-1">{t.cross_band_radio_1_dbm ?? '--'} / {t.cross_band_radio_2_dbm ?? '--'} dBm</div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Stat icon={RadioIcon} label="Radio 1" value={t.cross_band_radio_1_dbm ?? '--'} unit="dBm" />
            <Stat icon={RadioIcon} label="Radio 2" value={t.cross_band_radio_2_dbm ?? '--'} unit="dBm" />
            <Stat icon={RadioIcon} label="LoRa" value={t.lora_rssi_dbm ?? '--'} unit="dBm" />
            <Stat icon={Battery} label="Bat" value={t.battery_v?.toFixed(2) ?? '--'} unit="V" />
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
            <span className="font-mono text-[10px] text-muted-foreground">{t.battery_current_ma ?? '--'} mA draw</span>
            <span className="flex items-center gap-1 text-xs text-accent opacity-70 group-hover:opacity-100 transition">
              View <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-end gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Altitude</div>
              <div className="font-mono text-3xl font-bold strat-glow text-accent">
                {(Number(t.altitude_m || 0) / 1000).toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground -mt-0.5">kilometres</div>
            </div>
            <div className="flex-1 flex flex-col items-end gap-1 pb-1">
              <span className={`flex items-center gap-1 text-xs font-mono ${climbing ? 'text-sky-400' : 'text-amber-400'}`}>
                {climbing ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {typeof t.vertical_speed_ms === 'number' ? `${t.vertical_speed_ms >= 0 ? '+' : ''}${t.vertical_speed_ms}` : '—'} m/s
              </span>
              {maxAlt > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                  <Mountain className="w-3 h-3" /> max {(maxAlt / 1000).toFixed(2)} km
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Stat icon={Thermometer} label="Temp" value={t.temperature_c?.toFixed(0)} unit="°C" />
            <Stat icon={Gauge} label="Pres" value={t.pressure_hpa?.toFixed(0)} unit="hPa" />
            <Stat icon={Battery} label="Bat" value={t.battery_v?.toFixed(2)} unit="V" />
            <Stat icon={RadioIcon} label="nRF" value={t.nrf_rssi_dbm} unit="dBm" />
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
            <span className="font-mono text-[10px] text-muted-foreground">
              {t.latitude?.toFixed(4)}, {t.longitude?.toFixed(4)}
            </span>
            <span className="flex items-center gap-1 text-xs text-accent opacity-70 group-hover:opacity-100 transition">
              Track <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </>
      )}
    </button>
  );
}