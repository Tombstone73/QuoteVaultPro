import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from 'react-router-dom';
import { apiCall } from '@/hooks/useFulfillment';

type UpsStatus = { configured: boolean; connected: boolean; verified: boolean; mode: 'test' | 'live' | null;
  accountLast4: string | null; message: string };

export default function ShippingSettings() {
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [callback, setCallback] = useState(() => new URLSearchParams(window.location.search).get('ups'));
  useEffect(() => {
    if (!callback) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('ups');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['ups', 'connection'], queryFn: () => apiCall<UpsStatus>('/api/integrations/ups/status') });
  const connect = useMutation({ mutationFn: (number: string) => apiCall<{ authorizeUrl: string }>('/api/integrations/ups/connect',
    { method: 'POST', body: JSON.stringify({ accountNumber: number }) }),
    onSuccess: ({ authorizeUrl }) => { setCallback(null); window.location.assign(authorizeUrl); } });
  const disconnect = useMutation({ mutationFn: () => apiCall<UpsStatus>('/api/integrations/ups/disconnect', { method: 'POST' }),
    onSuccess: () => { setConfirmDisconnect(false); setCallback(null); setAccountNumber(''); void queryClient.invalidateQueries({ queryKey: ['ups', 'connection'] }); } });
  return <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
    <div><h1 className="text-2xl font-semibold">Shipping Settings</h1>
      <p className="text-sm text-muted-foreground">Connect this organization’s UPS account for carrier rate estimates.</p></div>
    <Card><CardHeader><CardTitle>UPS account</CardTitle><CardDescription>
      Authorize your account with UPS. Your UPS password is entered on UPS’s site; PrintersHero stores encrypted authorization tokens.
    </CardDescription></CardHeader><CardContent className="space-y-4">
      {callback === 'connected' && <p role="status" className="text-sm">UPS authorization saved. Request a rate on a DRAFT shipment to verify the account number and Rating API access.</p>}
      {callback && callback !== 'connected' && <p role="alert" className="text-sm text-destructive">UPS connection did not complete ({callback.replaceAll('_', ' ')}). Please try again.</p>}
      <p role="status" className="text-sm">{status.isLoading ? 'Checking UPS connection…' : status.data?.message ?? 'UPS status is unavailable.'}</p>
      {status.data?.accountLast4 && <p className="text-sm">Saved account ending {status.data.accountLast4} · {status.data.mode === 'live' ? 'UPS production' : 'UPS test environment'}{status.data.verified ? ' · Rating verified' : ' · Rating not yet verified'}</p>}
      <div className="max-w-xs space-y-1"><Label htmlFor="ups-account-number">UPS shipper/account number</Label>
        <Input id="ups-account-number" value={accountNumber} onChange={event => setAccountNumber(event.target.value.toUpperCase())}
          autoComplete="off" maxLength={10} placeholder="Enter account number" />
        <p className="text-xs text-muted-foreground">The number identifies the account; UPS login authorizes access. Reconnect to change the saved number.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!status.data?.configured || connect.isPending || disconnect.isPending || !accountNumber.trim()}
          onClick={() => connect.mutate(accountNumber.trim())}>{connect.isPending ? 'Opening UPS…' : status.data?.connected ? 'Update / reconnect UPS' : 'Connect UPS'}</Button>
        {status.data?.accountLast4 && <Button type="button" variant="outline" disabled={connect.isPending || disconnect.isPending}
          onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>}
      </div>
      {confirmDisconnect && <div className="rounded border p-3 space-y-2 text-sm"><p>Disconnect this organization’s UPS account? Rate requests will stop until it is reconnected.</p>
        <div className="flex gap-2"><Button variant="destructive" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>{disconnect.isPending ? 'Disconnecting…' : 'Confirm disconnect'}</Button>
          <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>Cancel</Button></div></div>}
      {connect.error && <p role="alert" className="text-sm text-destructive">{connect.error.message}</p>}
      {disconnect.error && <p role="alert" className="text-sm text-destructive">{disconnect.error.message}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Shipping label printer</CardTitle><CardDescription>Assign a 4 × 6 inch Windows label printer for direct UPS label printing. Browser preview and download remain available without an agent.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link to="/settings/printers">Configure printer profiles</Link></Button></CardContent></Card>
  </div>;
}
