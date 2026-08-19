import { useEffect, useState } from 'react';
import { telemetry } from '@/lib/mqttService';
import CubeCard from '@/components/CubeCard';
import TopBar from '@/components/TopBar';
import StarfieldBackground from '@/components/StarfieldBackground';
import ConnectionSettings from '@/components/ConnectionSettings';
import BurstAlerts from '@/components/BurstAlerts';
import AprsTelemetry from '@/components/AprsTelemetry';
import SondehubTelemetry from '@/components/SondehubTelemetry';
import PicoBalloonTelemetry from '@/components/PicoBalloonTelemetry';
import RotatorTelemetry from '@/components/RotatorTelemetry';
import { clearObserver } from '@/lib/observer';
import ChatRoom from '@/components/ChatRoom';
import { useNavigate } from 'react-router-dom';
import { Rocket, Satellite } from 'lucide-react';

export default function MissionControl({ observer, onSignOut }) {
  const [cubes, setCubes] = useState(telemetry.getCubes());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeFeed, setActiveFeed] = useState('aprs');
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = telemetry.subscribe(setCubes);
    telemetry.connect();
    return unsub;
  }, []);

  const signOut = () => {
    clearObserver();
    onSignOut();
  };

  return (
    <div className="min-h-screen">
      <StarfieldBackground />
      <TopBar
        observer={observer}
        onSignOut={signOut}
        onOpenSettings={() => setSettingsOpen(true)}
        activeFeed={activeFeed}
        onFeedChange={setActiveFeed}
      />

      <main className="w-full px-3 sm:px-4 lg:px-5 py-6 sm:py-8">
        <section className="mb-6">
          <BurstAlerts />
        </section>

        {/* hero */}
        <section className="mb-7">
          <div className="flex items-center gap-2 text-accent mb-2">
            <Rocket className="w-4 h-4" />
            <span className="text-xs font-mono tracking-[0.25em] uppercase">Stratospheric Balloon Mission</span>
          </div>
          <h1 className="font-heading text-43xl sm:text-5xl font-bold leading-[1.05]">
            BACAR Skybridge <span className="strat-grad-text">14</span>
          </h1>
          <p className="text-muted-foreground mt-2 max-w-16xl text-sm sm:text-base">
            Live telemetry from a fleet of CUBE payloads ascending toward 35 km. Tracking altitude, position,
            atmospheric conditions, and nRF-relayed imagery across multiple cubes sharing one MQTT channel.
          </p>
        </section>

        {/* stats strip */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-7">
          {[
            { label: 'Active CUBEs', value: cubes.filter((c) => c.telemetry).length, total: cubes.length, icon: Satellite },
            { label: 'Peak Altitude', value: peakAlt(cubes), unit: 'km' },
            { label: 'Avg Ascent', value: avgClimb(cubes), unit: 'm/s' },
            { label: 'Avg Distance', value: avgDistance(cubes), unit: 'km' },
            { label: 'nRF Images', value: cubes.reduce((a, c) => a + (c.images?.length || 0), 0), unit: 'frames' },
          ].map((s, i) => (
            <div key={i} className="strat-card rounded-xl p-3.5 border border-border/50">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="font-mono text-2xl font-bold mt-0.5">
                {s.value}
                <span className="text-sm text-muted-foreground font-normal ml-1">{s.unit}</span>
              </div>
            </div>
          ))}
        </section>

        {activeFeed === 'aprs'
          ? <AprsTelemetry />
          : activeFeed === 'sondehub'
            ? <SondehubTelemetry />
            : activeFeed === 'pico'
              ? <PicoBalloonTelemetry />
              : <RotatorTelemetry />}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-stretch w-full">
          <div className="min-w-0 w-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading font-semibold text-lg">Payload CUBEs</h2>
              <span className="text-xs text-muted-foreground font-mono">tap a cube for full track</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {cubes.map((cube) => (
                <CubeCard key={cube.id} cube={cube} onOpen={(id) => navigate(`/cube/${id}`)} />
              ))}
            </div>
          </div>

          <div className="w-full xl:flex xl:justify-end">
            <div className="w-full xl:h-[calc(100vh-12rem)] xl:max-h-[calc(100vh-12rem)]">
              <ChatRoom observer={observer} />
            </div>
          </div>
        </section>
      </main>

      <ConnectionSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function peakAlt(cubes) {
  const m = Math.max(0, ...cubes.flatMap((c) => c.history?.map((h) => h.altitude_m || 0) || [0]));
  return (m / 1000).toFixed(2);
}
function avgClimb(cubes) {
  const ts = cubes.filter((c) => c.telemetry).map((c) => c.telemetry.vertical_speed_ms || 0);
  if (!ts.length) return '0';
  return (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1);
}

function avgDistance(cubes) {
  const distances = cubes
    .filter((c) => c.telemetry && Number.isFinite(c.telemetry.latitude) && Number.isFinite(c.telemetry.longitude))
    .map((c) => {
      const launchLat = c.profile?.startLat ?? 0;
      const launchLon = c.profile?.startLon ?? 0;
      return Math.sqrt(
        ((c.telemetry.latitude - launchLat) * 111.32) ** 2 +
        ((c.telemetry.longitude - launchLon) * 111.32 * Math.cos((launchLat * Math.PI) / 180)) ** 2
      );
    });

  if (!distances.length) return '0.00';
  return (distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(2);
}