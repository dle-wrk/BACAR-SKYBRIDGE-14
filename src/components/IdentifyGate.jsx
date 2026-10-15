import { useState } from 'react';
import { Radio, MapPin, ArrowRight, Check, Crosshair, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidGrid, normalizeGrid, setObserver } from '@/lib/observer';

// Full 6-char grids resolve to a ~5' × 2.5' square — accurate enough to
// put a map pin on a specific suburb; 4-char grids only resolve to a
// 2° × 1° square (covering several towns), so for a mission map we
// require the full 6-char form.
const GRID_RE_FULL = /^[A-R]{2}[0-9]{2}[A-X]{2}$/;

export default function IdentifyGate({ onIdentified }) {
  const [mode, setMode] = useState('ham');
  const [callsign, setCallsign] = useState('');
  const [grid, setGrid] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);

  // Browser geolocation → fills Location + optionally stashes raw coords
  // on the observer so the "Who's Watching" map can pin them without any
  // reverse-geocoding dance.
  const [coords, setCoords] = useState(null);
  const requestGeo = () => {
    if (!navigator.geolocation) {
      setError('This browser does not expose geolocation.');
      return;
    }
    setGeoBusy(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lon: longitude });
        // Best-effort reverse geocode via OpenStreetMap Nominatim (public,
        // no key; rate-limited but fine for a one-shot on identify).
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=12`,
            { headers: { 'accept': 'application/json' } },
          );
          if (resp.ok) {
            const j = await resp.json();
            const a = j?.address || {};
            const area = [
              a.suburb || a.neighbourhood || a.village || a.town || a.city || a.hamlet,
              a.state || a.province || a.region,
              a.country_code ? a.country_code.toUpperCase() : null,
            ].filter(Boolean).join(', ');
            if (area) setLocation(area);
          }
        } catch { /* best effort, ignore */ }
        setGeoBusy(false);
      },
      (err) => {
        setGeoBusy(false);
        setError(`Location unavailable: ${err.message || 'permission denied'}`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'ham') {
      const cs = callsign.trim();
      const g = normalizeGrid(grid);
      if (cs.length < 3) return setError('Callsign must be at least 3 characters.');
      if (!GRID_RE_FULL.test(g)) {
        return setError('Grid locator must be the full 6 characters (e.g. KG44AB). 4-char grids are too coarse for the map.');
      }
      if (!isValidGrid(g)) return setError('Grid locator is not valid Maidenhead.');
      const obs = { type: 'ham', callsign: cs.toUpperCase(), grid: g, joined: Date.now() };
      setObserver(obs);
      onIdentified(obs);
    } else {
      const n = name.trim();
      if (n.length < 2) return setError('Please enter a name.');
      const loc = location.trim();
      if (loc.length < 2) return setError('Please enter a location (or tap "Use my location").');
      const obs = {
        type: 'observer',
        name: n,
        location: loc,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        joined: Date.now(),
      };
      setObserver(obs);
      onIdentified(obs);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg strat-card strat-ring-glow rounded-2xl p-6 sm:p-9">
        <div className="flex items-center gap-2 text-accent mb-1">
          <Radio className="w-5 h-5" />
          <span className="text-xs font-mono tracking-[0.3em] uppercase">BACAR Skybridge 14</span>
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold leading-tight">
          Stratosphere <span className="strat-grad-text">Mission Control</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Identify yourself to join the live telemetry feed. No password needed — this is a public mission channel.
        </p>

        <div className="grid grid-cols-2 gap-2 mt-6 p-1 bg-secondary/50 rounded-xl">
          <button
            type="button"
            onClick={() => { setMode('ham'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition ${
              mode === 'ham' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Radio className="w-4 h-4" /> Amateur Radio
          </button>
          <button
            type="button"
            onClick={() => { setMode('observer'); setError(''); }}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition ${
              mode === 'observer' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MapPin className="w-4 h-4" /> Observer
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 mt-5">
          {mode === 'ham' ? (
            <>
              <div>
                <Label htmlFor="callsign">Callsign</Label>
                <Input
                  id="callsign"
                  value={callsign}
                  onChange={(e) => setCallsign(e.target.value)}
                  placeholder="e.g. ZS6ABC"
                  className="font-mono uppercase mt-1.5"
                  autoCapitalize="characters"
                  maxLength={10}
                />
              </div>
              <div>
                <Label htmlFor="grid">Maidenhead Grid Locator (6 chars required)</Label>
                <Input
                  id="grid"
                  value={grid}
                  onChange={(e) => setGrid(e.target.value)}
                  placeholder="e.g. KG44AB"
                  className="font-mono uppercase mt-1.5"
                  autoCapitalize="characters"
                  maxLength={6}
                  minLength={6}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Needs the full 6-character form (two letters + two digits + two letters) so the map pin is accurate
                  to about a 5 km square. 4-char grids cover a whole 2° × 1° region.
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="mt-1.5"
                  maxLength={40}
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="loc">Location</Label>
                  <button
                    type="button"
                    onClick={requestGeo}
                    disabled={geoBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground transition hover:border-accent hover:text-accent disabled:opacity-60"
                  >
                    {geoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
                    {geoBusy ? 'Locating…' : 'Use my location'}
                  </button>
                </div>
                <Input
                  id="loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Bloemfontein, ZA"
                  className="mt-1.5"
                  maxLength={80}
                />
                {coords && (
                  <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                    GPS fix: {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)} — will plot on the Who&apos;s Watching map.
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full h-11 text-base group">
            Enter Mission Control
            <ArrowRight className="w-4 h-4 ml-2 transition group-hover:translate-x-1" />
          </Button>
        </form>

        <div className="flex items-center gap-2 mt-5 text-xs text-muted-foreground">
          <Check className="w-3.5 h-3.5 text-accent" />
          Public access — your identifier is stored only on this device.
        </div>
      </div>
    </div>
  );
}
