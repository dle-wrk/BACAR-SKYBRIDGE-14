import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { telemetry } from '@/lib/mqttService';
import TopBar from '@/components/TopBar';
import StarfieldBackground from '@/components/StarfieldBackground';
import TelemetryChart from '@/components/TelemetryChart';
import ImageStrip from '@/components/ImageStrip';
import ConnectionSettings from '@/components/ConnectionSettings';
import { clearObserver } from '@/lib/observer';
import { ArrowLeft, Mountain, Thermometer, Gauge, Battery, Radio as RadioIcon, Satellite, Clock, MapPin, Sun } from 'lucide-react';

export default function CubeDetail({ observer, onSignOut }) {
  const { cubeId } = useParams();
  const navigate = useNavigate();
  const [, setTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const unsub = telemetry.subscribe(() => setTick((t) => t + 1));
    telemetry.connect();
    return unsub;
  }, []);

  const cube = telemetry.getCubes().find((c) => c.id === cubeId);

  const signOut = () => { clearObserver(); onSignOut(); };

  if (!cube) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <StarfieldBackground />
        <div className="text-center">
          <p className="text-muted-foreground mb-3">Cube not found.</p>
          <button onClick={() => navigate('/')} className="text-accent hover:underline">← Back to mission control</button>
        </div>
      </div>
    );
  }

  const t = cube.telemetry;
  const isNrfOnly = cube.mode === 'nrf_image_only';
  const isRadioOnly = cube.mode === 'radio_battery_only';
  const maxAlt = cube.history.length ? Math.max(...cube.history.map((h) => h.altitude_m || 0)) : 0;
  const ageMs = t ? Date.now() - t.t : null;
  const launchLat = cube.profile?.startLat ?? 0;
  const launchLon = cube.profile?.startLon ?? 0;
  const horizontalDistanceKm = t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)
    ? Math.sqrt(
        ((t.latitude - launchLat) * 111.32) ** 2 +
        ((t.longitude - launchLon) * 111.32 * Math.cos((launchLat * Math.PI) / 180)) ** 2
      )
    : 0;

  const rows = t && !isNrfOnly ? [
    { icon: Clock, label: 'Time', value: t.t ? new Date(t.t).toLocaleString() : '--' },
    { icon: Mountain, label: 'Altitude', value: `${t.altitude_m ?? '--'} m`, sub: `${((t.altitude_m ?? 0)/1000).toFixed(2)} km` },
    { icon: Gauge, label: 'Speed', value: `${t.speed_ms ?? '--'} m/s` },
    { icon: Gauge, label: 'Heading', value: `${t.heading_deg ?? '--'}°` },
    { icon: ArrowLeft, label: 'Vertical Speed', value: `${t.vertical_speed_ms >= 0 ? '+' : ''}${t.vertical_speed_ms ?? 0} m/s` },
    { icon: Thermometer, label: 'Temperature', value: `${t.temperature_c ?? '--'} °C` },
    { icon: Gauge, label: 'Pressure', value: `${t.air_pressure_hpa ?? t.pressure_hpa ?? '--'} hPa` },
    { icon: Thermometer, label: 'Humidity', value: `${t.humidity_pct ?? '--'} %` },
    { icon: Battery, label: 'Battery', value: `${t.battery_v ?? '--'} V / ${t.battery_current_ma ?? '--'} mA` },
    { icon: RadioIcon, label: 'Current Draw', value: `${t.battery_current_ma ?? '--'} mA` },
    { icon: RadioIcon, label: 'Status', value: `${t.status ?? '--'}` },
    { icon: RadioIcon, label: 'Errors', value: `${Array.isArray(t.errors) ? t.errors.join(', ') : t.errors ?? '--'}` },
    { icon: RadioIcon, label: 'nRF RSSI', value: `${t.nrf_rssi_dbm ?? '--'} dBm` },
    { icon: Satellite, label: 'GSM', value: `${t.gsm_signal_dbm ?? '--'} dBm` },
    { icon: MapPin, label: 'GPS', value: `${t.gps_fix ?? '3D fix'} · ${t.latitude ?? '--'}, ${t.longitude ?? '--'}`, mono: true },
    { icon: Sun, label: 'Ambient Light / IR', value: `${t.ambient_light_lux ?? '--'} lux / ${t.ir_ambient_c ?? '--'} °C` },
    { icon: Gauge, label: 'UV / VOC', value: `${t.uv_index ?? '--'} / ${t.voc_ppb ?? '--'} ppb` },
    { icon: Clock, label: 'RTC', value: `${t.rtc_epoch_s ? new Date(t.rtc_epoch_s * 1000).toLocaleTimeString() : '--'}` },
    { icon: Satellite, label: 'GPS Sats', value: `${t.satellites ?? '--'}` },
    { icon: MapPin, label: 'Position', value: `${t.latitude ?? '--'}, ${t.longitude ?? '--'}`, mono: true },
    { icon: RadioIcon, label: 'Cameras', value: `${t.cameras?.total_cameras ?? 0} cams · ${t.cameras?.image_count ?? 0} img / ${t.cameras?.video_count ?? 0} vid` },
  ] : isRadioOnly && t ? [
    { icon: Clock, label: 'Time', value: t.t ? new Date(t.t).toLocaleString() : '--' },
    { icon: RadioIcon, label: 'VHF Frequency', value: `${t.vhf_frequency ?? '--'} MHz` },
    { icon: RadioIcon, label: 'UHF Frequency', value: `${t.uhf_frequency ?? '--'} MHz` },
    { icon: RadioIcon, label: 'VHF Power', value: `${t.vhf_power ?? '--'} W` },
    { icon: RadioIcon, label: 'UHF Power', value: `${t.uhf_power ?? '--'} W` },
    { icon: RadioIcon, label: 'Cross-band radio 1', value: `${t.cross_band_radio_1_dbm ?? '--'} dBm` },
    { icon: RadioIcon, label: 'Cross-band radio 2', value: `${t.cross_band_radio_2_dbm ?? '--'} dBm` },
    { icon: RadioIcon, label: 'LoRa', value: `${t.lora_rssi_dbm ?? '--'} dBm` },
    { icon: Battery, label: 'Battery', value: `${t.battery_v ?? '--'} V / ${t.battery_current_ma ?? '--'} mA` },
    { icon: RadioIcon, label: 'Current Draw', value: `${t.battery_current_ma ?? '--'} mA` },
    { icon: Thermometer, label: 'Temperature', value: `${t.temperature_c ?? '--'} °C` },
    { icon: RadioIcon, label: 'Status', value: `${t.status ?? '--'}` },
    { icon: Mountain, label: 'Altitude', value: `${t.altitude_m ?? '--'} m` },
    { icon: ArrowLeft, label: 'Vertical Speed', value: `${t.vertical_speed_ms >= 0 ? '+' : ''}${t.vertical_speed_ms ?? 0} m/s` },
  ] : [];

  return (
    <div className="min-h-screen">
      <StarfieldBackground />
      <TopBar observer={observer} onSignOut={signOut} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Mission Control
        </button>

        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${t && ageMs < 15000 ? 'bg-emerald-400 live-dot' : 'bg-muted-foreground'}`} />
              <span className="font-mono text-xs text-muted-foreground">{cube.id}</span>
            </div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold mt-1">{cube.name}</h1>
          </div>
          {t && (
            <div className="text-right">
              <div className="font-mono text-4xl font-bold strat-glow text-accent">{(t.altitude_m/1000).toFixed(2)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">km altitude</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {horizontalDistanceKm.toFixed(2)} km from launch pad
              </div>
            </div>
          )}
        </div>

        {!t ? (
          <div className="strat-card rounded-2xl p-12 text-center text-muted-foreground border border-border/60">
            <RadioIcon className="w-8 h-8 mx-auto mb-3 opacity-40" />
            Awaiting telemetry from {cube.id}…
          </div>
        ) : isNrfOnly ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="strat-card rounded-2xl p-4 border border-border/60">
              <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                <RadioIcon className="w-4 h-4 text-accent" /> nRF / Imagery Feed
              </h3>
              <div className="flex items-center justify-between rounded-xl bg-secondary/30 px-3 py-3">
                <span className="text-sm text-muted-foreground">Signal strength</span>
                <span className="font-mono text-xl font-bold text-accent">{t.nrf_rssi_dbm ?? '--'} dBm</span>
              </div>
              <div className="flex items-center gap-1.5 mt-3 px-1 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" /> last update {new Date(t.t).toLocaleTimeString()}
              </div>
            </div>

            <div className="strat-card rounded-2xl p-4 border border-border/60">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading font-semibold flex items-center gap-2">
                  <RadioIcon className="w-4 h-4 text-accent" /> nRF Image Telemetry
                </h3>
                <span className="text-xs text-muted-foreground font-mono">{cube.images.length} frames</span>
              </div>
              <ImageStrip images={cube.images} />
            </div>
          </div>
        ) : isRadioOnly ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="strat-card rounded-2xl p-4 border border-border/60">
              <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                <RadioIcon className="w-4 h-4 text-accent" /> Cross-band Radio / LoRa
              </h3>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-secondary/30">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <r.icon className="w-3.5 h-3.5" /> {r.label}
                    </span>
                    <span className={`font-mono text-sm font-semibold text-right ${r.mono ? 'text-xs' : ''}`}>{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-3 px-3 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" /> last update {new Date(t.t).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* telemetry table */}
            <div className="strat-card rounded-2xl p-4 border border-border/60">
              <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
                <Satellite className="w-4 h-4 text-accent" /> Live Telemetry
              </h3>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-secondary/30">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <r.icon className="w-3.5 h-3.5" /> {r.label}
                    </span>
                    <span className={`font-mono text-sm font-semibold text-right ${r.mono ? 'text-xs' : ''}`}>{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-3 px-3 text-[10px] text-muted-foreground">
                <Clock className="w-3 h-3" /> last update {new Date(t.t).toLocaleTimeString()}
              </div>
              <div className="px-3 mt-1 text-[10px] text-muted-foreground">peak altitude {(maxAlt/1000).toFixed(2)} km</div>
            </div>

            {/* charts */}
            <div className="lg:col-span-2 space-y-4">
              <div className="strat-card rounded-2xl p-4 border border-border/60">
                <h3 className="font-heading font-semibold mb-3">Altitude Profile</h3>
                <TelemetryChart history={cube.history} metric="altitude_m" label="Altitude (m)" color="#38bdf8" height={220} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="strat-card rounded-2xl p-4 border border-border/60">
                  <h3 className="font-heading font-semibold mb-3 text-sm">Temperature</h3>
                  <TelemetryChart history={cube.history} metric="temperature_c" label="°C" color="#34d399" height={150} />
                </div>
                <div className="strat-card rounded-2xl p-4 border border-border/60">
                  <h3 className="font-heading font-semibold mb-3 text-sm">Pressure</h3>
                  <TelemetryChart history={cube.history} metric="pressure_hpa" label="hPa" color="#fb923c" height={150} />
                </div>
              </div>
              <div className="strat-card rounded-2xl p-4 border border-border/60">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-heading font-semibold flex items-center gap-2">
                    <RadioIcon className="w-4 h-4 text-accent" /> nRF Image Telemetry
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono">{cube.images.length} frames</span>
                </div>
                <ImageStrip images={cube.images} />
              </div>
            </div>
          </div>
        )}
      </main>

      <ConnectionSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}