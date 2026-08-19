import { useState } from 'react';
import { Radio, MapPin, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isValidGrid, normalizeGrid, setObserver } from '@/lib/observer';

// No-password identification: amateur radio operator (callsign + grid)
// or general observer (name + location).
export default function IdentifyGate({ onIdentified }) {
  const [mode, setMode] = useState('ham');
  const [callsign, setCallsign] = useState('');
  const [grid, setGrid] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'ham') {
      const cs = callsign.trim();
      const g = normalizeGrid(grid);
      if (cs.length < 3) return setError('Callsign must be at least 3 characters.');
      if (!isValidGrid(g)) return setError('Grid locator must be 4–6 chars, e.g. KG44 or KG44ab.');
      const obs = { type: 'ham', callsign: cs.toUpperCase(), grid: g, joined: Date.now() };
      setObserver(obs);
      onIdentified(obs);
    } else {
      const n = name.trim();
      if (n.length < 2) return setError('Please enter a name.');
      const loc = location.trim();
      if (loc.length < 2) return setError('Please enter a location.');
      const obs = { type: 'observer', name: n, location: loc, joined: Date.now() };
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
                <Label htmlFor="grid">Maidenhead Grid Locator (4–6 chars)</Label>
                <Input
                  id="grid"
                  value={grid}
                  onChange={(e) => setGrid(e.target.value)}
                  placeholder="e.g. KG44 or KG44ab"
                  className="font-mono uppercase mt-1.5"
                  autoCapitalize="characters"
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground mt-1.5">Used to plot your receiving station on the map.</p>
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
                <Label htmlFor="loc">Location</Label>
                <Input
                  id="loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Bloemfontein, ZA"
                  className="mt-1.5"
                  maxLength={60}
                />
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