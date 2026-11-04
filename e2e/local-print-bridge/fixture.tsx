import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrintBridgeRecovery, PrintBridgeConnection } from '@/components/production/PrintBridgeRecovery';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import '../../client/src/index.css';
function Fixture() {
  const { setTheme } = useTheme();
  const [state, setState] = useState<'connected' | 'reconnecting' | 'disconnected' | 'authentication_required'>('connected');
  return <div className="min-h-screen bg-background p-5 text-foreground">
    <p>Synthetic bridge status · no network, service or printer operations</p>
    <div className="my-3 flex gap-4"><button onClick={() => setTheme('light')}>Light</button><button onClick={() => setTheme('dark')}>Dark</button></div>
    <section className="max-w-2xl rounded border bg-card p-3 space-y-3"><h1>Print Bridge</h1>
      <PrintBridgeConnection status="active" connectionHealth={{ state, error: state === 'authentication_required' ? 'pairing_required' : state === 'connected' ? null : 'realtime_unavailable', reportedAt: new Date().toISOString() }} />
      <select aria-label="Synthetic connection state" className="border bg-background p-1" value={state} onChange={event => setState(event.target.value as typeof state)}>
        {['connected', 'reconnecting', 'disconnected', 'authentication_required'].map(value => <option key={value}>{value}</option>)}
      </select><PrintBridgeRecovery />
    </section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture /></ThemeProvider>);
