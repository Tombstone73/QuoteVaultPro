import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import StripePayDialog from '../../client/src/components/payments/StripePayDialog';
import '../../client/src/index.css';

(window as any).fixtureAudit = { mounts: 0, unmounts: 0, submits: 0, confirms: 0 };
function Fixture() {
  const [open, setOpen] = useState(true);
  const grouped = new URLSearchParams(location.search).has('grouped');
  return <><button onClick={() => setOpen(true)}>Open payment fixture</button><StripePayDialog open={open} onOpenChange={setOpen}
    invoiceId="fixture" apiBasePath={grouped ? '/api/portal/invoices' : '/api/guest/invoices'} groupedInitiation={grouped}
    invoiceIds={grouped ? ['fixture', 'fixture2'] : undefined}
    invoiceSummaries={grouped ? [{ invoiceNumber: 'Fixture 1', amountDue: 5 }, { invoiceNumber: 'Fixture 2', amountDue: 7 }] : undefined}
    onSettled={async () => ({ reconciled: false })} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
