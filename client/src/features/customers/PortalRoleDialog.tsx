import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PORTAL_ROLES, PORTAL_ROLE_LABELS, portalRoleDescription, type PortalRole } from '@shared/portalPermissions';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export function PortalRoleDialog({ customerId, access, onClose }: { customerId: string; access: { id: string; email: string; accessRole: PortalRole }; onClose: () => void }) {
  const [role, setRole] = useState<PortalRole>(access.accessRole);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const client = useQueryClient();
  const { toast } = useToast();
  const mutation = useMutation({ mutationFn: async () => {
    const response = await fetch(`/api/customers/${customerId}/portal-access/${access.id}/role`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, expectedRole: access.accessRole }) });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) throw new Error(payload.message || 'Role change failed. Refresh and try again.');
  } });
  async function save() {
    if (!confirmed || role === access.accessRole || submitting.current) return;
    submitting.current = true; setError(null);
    try {
      await mutation.mutateAsync();
      await Promise.all([client.invalidateQueries({ queryKey: [`/api/customers/${customerId}/portal-access`] }), client.invalidateQueries({ queryKey: ['portal', 'me'] }), client.invalidateQueries({ queryKey: ['portal', 'invoices'] })]);
      toast({ title: 'Portal role updated', description: `${access.email}: ${PORTAL_ROLE_LABELS[role]}` }); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Role change failed.'); }
    finally { submitting.current = false; }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Change portal role</DialogTitle><DialogDescription>{access.email}. Current role: {PORTAL_ROLE_LABELS[access.accessRole]}. Changes apply to subsequent portal requests.</DialogDescription></DialogHeader>
    <label className="space-y-1 text-sm">New role<select aria-label="New portal role" className="w-full rounded-md border bg-background p-2" value={role} disabled={mutation.isPending} onChange={event => { setRole(event.target.value as PortalRole); setConfirmed(false); }}>
      {PORTAL_ROLES.map(value => <option key={value} value={value}>{PORTAL_ROLE_LABELS[value]}</option>)}
    </select></label>
    <ul className="space-y-2 text-sm">{PORTAL_ROLES.map(value => <li key={value}><strong>{PORTAL_ROLE_LABELS[value]}:</strong> {portalRoleDescription(value)}</li>)}</ul>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={mutation.isPending} onChange={event => setConfirmed(event.target.checked)} />Confirm changing {PORTAL_ROLE_LABELS[access.accessRole]} to {PORTAL_ROLE_LABELS[role]}</label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button><Button disabled={!confirmed || role === access.accessRole || mutation.isPending} onClick={() => void save()}>{mutation.isPending ? 'Saving…' : 'Save Role'}</Button></div>
  </DialogContent></Dialog>;
}
