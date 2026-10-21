import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from 'react-router-dom';
import { apiCall } from '@/hooks/useFulfillment';
import { usePrinterProfiles, useSetDefaultPrinterProfile } from '@/hooks/usePrinterProfiles';

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
  const shippingPrinters = usePrinterProfiles({ active: true, printerType: 'shipping_label' });
  const setShippingDefault = useSetDefaultPrinterProfile();
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
      {status.data?.mode && <p role="status" className={status.data.mode === 'test' ? 'rounded border border-amber-500 bg-amber-50 p-2 text-sm text-amber-900' : 'rounded border border-green-600 p-2 text-sm'}>
        UPS environment: <strong>{status.data.mode === 'live' ? 'Live' : 'Sandbox / Test'}</strong>.
        {status.data.mode === 'test' ? ' Test labels and tracking cannot be used for real shipments.' : ' Live labels may be used for shipping after carrier confirmation.'}
      </p>}
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
    <Card><CardHeader><CardTitle>Shipping label printer</CardTitle><CardDescription>Shipping uses the same saved printer profiles as Printers. Select an active 4 × 6 inch label profile; each profile maps to an exact queue on a paired Windows workstation. Browser preview and download remain available without an agent.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {shippingPrinters.isLoading ? <p className="text-sm">Loading shipping printer profiles…</p> : null}
        {shippingPrinters.isError ? <p role="alert" className="text-sm text-destructive">Could not load printer profiles. Open Printers to check the configuration.</p> : null}
        {shippingPrinters.data?.filter(profile => profile.supportedDocuments?.includes('ups_label')).map(profile => <div key={profile.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
          <span><strong>{profile.displayName}</strong> · {profile.windowsQueueName || 'Queue missing'}{profile.isDefault && profile.intendedUse === 'shipping_label' ? ' · Shipping default' : ''}
            {profile.intendedUse !== 'shipping_label' ? ' · Change Intended use to shipping_label in Printers before setting a shipping default' : ''}</span>
          {!profile.isDefault ? <Button size="sm" variant="outline" disabled={setShippingDefault.isPending || !profile.printAgentId || !profile.windowsQueueName || profile.intendedUse !== 'shipping_label'}
            onClick={() => setShippingDefault.mutate(profile.id)}>Set default</Button> : null}
        </div>)}
        {setShippingDefault.error ? <p role="alert" className="text-sm text-destructive">{setShippingDefault.error.message}</p> : null}
        {!shippingPrinters.isLoading && !shippingPrinters.data?.some(profile => profile.supportedDocuments?.includes('ups_label')) ? <p className="text-sm text-muted-foreground">No UPS label profile is ready. Pair a Print Agent, choose its Windows label queue in Printers, enable UPS labels, then run Test Print.</p> : null}
        <Button asChild variant="outline"><Link to="/settings/printers">Manage the same printer profiles</Link></Button>
      </CardContent></Card>
  </div>;
}
