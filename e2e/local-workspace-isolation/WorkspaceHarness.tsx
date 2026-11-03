import React, { useState } from 'react';
import { useNavigate, type Location } from 'react-router-dom';
import { QuoteEditorPage } from '@/features/quotes/editor/QuoteEditorPage';
import CustomerForm from '@/components/customer-form';
import { WorkspaceBoundary } from '@/contexts/WorkspaceContext';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** Synthetic test host only. No workspace selector/tab UI is shipped in the application. */
export function WorkspaceHarness() {
  const [active, setActive] = useState('order-a');
  const [dialog, setDialog] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [navigation, setNavigation] = useState('');
  const navigate = useNavigate();
  const { getGuardDiagnostics } = useNavigationGuard();
  Object.assign(window, { __workspaceSwitch: setActive, __workspaceGuards: getGuardDiagnostics });
  return <>
    <div className="flex flex-wrap gap-3 bg-background p-2 text-sm text-foreground">
      <span>Synthetic isolation fixture — edits remain in memory</span>
      {['order-a', 'order-b', 'quote', 'customer'].map(id => <button key={id} onClick={() => setActive(id)}>{id}</button>)}
      <button onClick={() => setDialog(true)}>Open fixture dialog</button>
      <button onClick={() => navigate('/orders/new?browser-history=1')}>Browser route</button>
      <output data-testid="fixture-navigation">{navigation}</output>
    </div>
    {(['order-a', 'order-b', 'quote', 'customer'] as const).map(id => <WorkspaceBoundary key={id} workspaceId={id} active={active === id}
      route={{ location: { pathname: id === 'quote' ? '/quotes/new' : id === 'customer' ? '/customers/synthetic' : '/orders/new', search: '', hash: '', state: null, key: id } satisfies Location, params: {} }}
      onNavigate={to => { setNavigation(`${id}: ${typeof to === 'string' || typeof to === 'number' ? to : to.pathname}`); }}
      scrollMode="contained" style={{ height: 'calc(100vh - 100px)' }}>
      {id === 'customer' ? <><button className="m-3 rounded border p-2" onClick={() => setCustomerOpen(true)}>Edit synthetic company</button><CustomerForm open={customerOpen} onOpenChange={setCustomerOpen}/></>
        : <QuoteEditorPage mode="edit" createTarget={id === 'quote' ? 'quote' : 'order'}/>}
      {id === 'order-a' && <Dialog open={dialog} onOpenChange={setDialog}><DialogContent><DialogTitle>Retained workspace dialog</DialogTitle><DialogDescription>Synthetic, never submitted</DialogDescription><Input aria-label="Isolated dialog notes" defaultValue=""/></DialogContent></Dialog>}
    </WorkspaceBoundary>)}
  </>;
}
