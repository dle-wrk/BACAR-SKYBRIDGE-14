import { useState } from 'react';
import { X, Wifi, Loader2, Check, Radio } from 'lucide-react';
import { telemetry } from '@/lib/mqttService';
import { MQTT_TOPICS } from '@/lib/mqttService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ConnectionSettings({ open, onClose }) {
  const [url, setUrl] = useState(telemetry.getBrokerUrl());
  const [connecting, setConnecting] = useState(false);
  if (!open) return null;

  const connect = () => {
    setConnecting(true);
    telemetry.connect(url);
    setTimeout(() => { setConnecting(false); onClose(); }, 600);
  };

  const useSimulation = () => {
    setUrl('');
    telemetry.setBrokerUrl('');
    telemetry.connect('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md strat-card strat-ring-glow rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-accent" />
            <h2 className="font-heading font-semibold text-lg">MQTT Connection</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Connect to the EMQX MQTT broker over WebSocket. The supplied <code className="font-mono text-xs text-accent">broker.emqx.io:1883</code>{' '}
          address is exposed to browsers through its WebSocket endpoint. Enter a broker URL (must use{' '}
          <code className="font-mono text-xs text-accent">ws://</code> or{' '}
          <code className="font-mono text-xs text-accent">wss://</code>).
        </p>

        <div className="space-y-2">
          <Label htmlFor="broker">Broker WebSocket URL</Label>
          <Input
            id="broker"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://broker.emqx.io:8083/mqtt"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Telemetry topics: <code className="font-mono">{Object.values(MQTT_TOPICS).filter((topic) => topic.endsWith('/telemetry')).join(', ')}</code>
            <br />Chat: <code className="font-mono">{MQTT_TOPICS.chat}</code> · Attendees: <code className="font-mono">{MQTT_TOPICS.attendees}</code>
          </p>
        </div>

        <div className="flex gap-2 mt-5">
          <Button onClick={connect} disabled={connecting} className="flex-1">
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            <span className="ml-2">Connect</span>
          </Button>
          <Button variant="secondary" onClick={useSimulation} className="flex-1">
            <Radio className="w-4 h-4" />
            <span className="ml-2">Use Simulation</span>
          </Button>
        </div>
      </div>
    </div>
  );
}