import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoicesTable } from './EnhancedCustomerView';
import { apiFetch } from '@/lib/queryClient';
import { useInvoicesPage } from '@/hooks/useInvoices';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navigate = jest.fn(), toast = jest.fn();
let paymentProps: any;
let activeOrgId = 'org-a';
let globalAdmin = false;
let userRole = 'member';
let rows: any[];
const invoice = (id: string, status = 'billed', balanceDue = '50.00') => ({ id, customerId: 'customer-a', invoiceNumber: id, status, balanceDue, total: '50.00', amountPaid: '0', displayRemaining: balanceDue });
jest.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({pathname:'/customers/customer-a',search:'?tab=invoices'}), Link: ({children,to}:any) => <a href={to}>{children}</a> }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({user:{id:'staff',lastActiveOrgId:'org-a',role:userRole},isAdmin:globalAdmin}) }));
jest.mock('@/hooks/useActiveOrganizationRole', () => ({useActiveOrganizationRole: () => ({activeOrgId})}));
jest.mock('@/hooks/useInvoices', () => ({useInvoicesPage:jest.fn(),useApproveInvoicesForAccounting:()=>({isPending:false,mutateAsync:jest.fn()})}));
jest.mock('@/hooks/useCustomer', () => ({useCustomer:jest.fn()}));
jest.mock('@/hooks/useOrders', () => ({useOrders:jest.fn()}));
jest.mock('@/hooks/use-toast', () => ({useToast:()=>({toast})}));
jest.mock('@/hooks/useTableColumnConfig', () => ({useTableColumnConfig:(_key:any,columns:any)=>({columns,reset:jest.fn(),canMoveColumn:()=>false,moveColumn:jest.fn(),setColumnVisibility:jest.fn()})}));
jest.mock('@/components/customer-form', () => ({__esModule:true,default:()=>null}));
jest.mock('@/components/contact-form', () => ({__esModule:true,default:()=>null}));
jest.mock('./CustomerIdentityBlock', () => ({CustomerIdentityBlock:()=>null}));
jest.mock('./CustomerActionsMenu', () => ({CustomerActionsMenu:()=>null}));
jest.mock('./TransactionsTab', () => ({__esModule:true,default:()=>null}));
jest.mock('./CurrentCustomerStatement', () => ({__esModule:true,default:()=>null}));
jest.mock('./InvoiceRecipientContactControl', () => ({InvoiceRecipientContactControl:()=>null}));
jest.mock('@/components/BackNavControls', () => ({__esModule:true,default:()=>null}));
jest.mock('@/components/ContactFlagPill', () => ({ContactFlagPill:()=>null}));
jest.mock('@/components/invoices/InvoiceSendQuickAction', () => ({InvoiceSendQuickAction:()=>null}));
jest.mock('@/components/orders/OrdersListStatusCell', () => ({OrdersListStatusCell:()=>null}));
jest.mock('@/components/orders/CloseJobOverrideDialog', () => ({CloseJobOverrideAction:()=>null,CloseJobOverrideDialog:()=>null,getOrderJobStatus:()=> 'new'}));
jest.mock('@/components/invoices/MultiInvoicePaymentDialog', () => ({MultiInvoicePaymentDialog:(props:any)=>{paymentProps=props;return <div data-testid="existing-payment-dialog">Existing payment dialog</div>;}}));
let root:Root, client:QueryClient;
const baseProps={customerId:'customer-a',searchQuery:'',statusFilter:'all'};
const permissions=(payment:boolean)=>({ok:true,json:async()=>({data:{payment,send:false,markSent:false,approve:false}})});
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(node=>node.textContent===label)!;
const checkbox=(label:string)=>document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});};
async function render(props=baseProps){await act(async()=>root.render(<QueryClientProvider client={client}><InvoicesTable {...props}/></QueryClientProvider>));await flush();}
function click(node:HTMLElement){act(()=>node.click());}
beforeEach(()=>{
 jest.clearAllMocks();window.localStorage.clear();paymentProps=null;activeOrgId='org-a';globalAdmin=false;userRole='member';rows=[invoice('a'),invoice('b','partially_paid','20'),invoice('paid','paid','0'),invoice('void','void','50')];
 (apiFetch as jest.Mock).mockResolvedValue(permissions(true));
 (useInvoicesPage as jest.Mock).mockImplementation(()=>({isLoading:false,data:{items:rows,pagination:{page:1,pageSize:50,totalCount:4,totalPages:1}}}));
 const host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{act(()=>root.unmount());client.clear();document.body.innerHTML='';});
test('keeps the canonical Customer filter, search, sort and pagination query',async()=>{
 await render({...baseProps,searchQuery:'signs',statusFilter:'unpaid'});
 expect(useInvoicesPage).toHaveBeenLastCalledWith(expect.objectContaining({customerId:'customer-a',search:'signs',status:'unpaid',page:1,pageSize:50}));expect(paymentProps).toBeNull();
});
test('single row Take Payment passes exactly one invoice to the existing dialog without navigating or posting a payment',async()=>{
 await render();const action=checkbox('Take payment for invoice a');act(()=>{action.click();action.click();});
 expect(document.querySelectorAll('[data-testid="existing-payment-dialog"]')).toHaveLength(1);expect(paymentProps.invoiceIds).toEqual(['a']);expect(paymentProps.open).toBe(true);expect(navigate).not.toHaveBeenCalled();expect(apiFetch).toHaveBeenCalledTimes(1);expect((apiFetch as jest.Mock).mock.calls[0][0]).toBe('/api/invoices/bulk-action-permissions');expect(toast).not.toHaveBeenCalled();
});
test('multiple selections use existing invoice IDs once and Clear Selection resets the toolbar',async()=>{
 await render();click(checkbox('Select invoice a for payment'));click(checkbox('Select invoice b for payment'));expect(document.body.textContent).toContain('2 invoices selected');click(button('Clear Selection'));expect(document.querySelector('[role=toolbar]')).toBeNull();
 click(checkbox('Select all payable invoices on this page'));click(button('Add Payment'));expect(paymentProps.invoiceIds).toEqual(['a','b']);expect(checkbox('Select invoice a for payment').disabled).toBe(true);
});
test('fully paid and void invoices are never selectable or given payment actions',async()=>{
 await render();for(const id of ['paid','void']){expect(checkbox(`Select invoice ${id} for payment`).disabled).toBe(true);expect(checkbox(`Take payment for invoice ${id}`)).toBeNull();}
});
test('effective server permission enables an authorized member independently of global roles',async()=>{
 await render();expect(checkbox('Take payment for invoice a')).not.toBeNull();expect(client.getQueryData(['invoice-bulk-action-permissions','staff','org-a'])).toEqual(expect.objectContaining({payment:true}));
});
test('global admin cannot bypass denied effective payment permission',async()=>{
 globalAdmin=true;userRole='admin';(apiFetch as jest.Mock).mockResolvedValue(permissions(false));await render();expect(checkbox('Take payment for invoice a')).toBeNull();expect(checkbox('Select invoice a for payment')).toBeNull();expect(paymentProps).toBeNull();
});
test.each(['loading','error'])('permission %s fails closed without a payment entry point',async mode=>{
 if(mode==='loading')(apiFetch as jest.Mock).mockReturnValue(new Promise(()=>{}));else (apiFetch as jest.Mock).mockResolvedValue({ok:false});
 const error=jest.spyOn(console,'error').mockImplementation(()=>{});try{await render();expect(checkbox('Take payment for invoice a')).toBeNull();expect(checkbox('Select invoice a for payment')).toBeNull();}finally{error.mockRestore();}
});
test('only canonical payment success clears selection and refreshes invoice balances and Customer summaries',async()=>{
 const invalidate=jest.spyOn(client,'invalidateQueries');await render();click(checkbox('Select invoice a for payment'));click(button('Add Payment'));expect(invalidate).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();
 await act(async()=>{paymentProps.onSuccess();});expect(document.querySelector('[data-testid="existing-payment-dialog"]')).toBeNull();expect(document.querySelector('[role=toolbar]')).toBeNull();
 for(const key of [['invoices'],['/api/customers'],['/api/customers/customer-a'],['/api/customers','customer-a','activity'],['/api/customers/customer-a/transactions'],['customer-current-statement','customer-a'],['customerFinancialExposure']])expect(invalidate).toHaveBeenCalledWith({queryKey:key});
});
test('cancel does not report success or invalidate balances and retains selection',async()=>{
 const invalidate=jest.spyOn(client,'invalidateQueries');await render();click(checkbox('Select invoice a for payment'));click(button('Add Payment'));act(()=>paymentProps.onOpenChange(false));expect(invalidate).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();expect(document.body.textContent).toContain('1 invoices selected');
});
test('Customer/filter changes cannot carry a payment selection into another view',async()=>{
 await render();click(checkbox('Select invoice a for payment'));await render({...baseProps,customerId:'customer-b'});expect(document.querySelector('[role=toolbar]')).toBeNull();expect(paymentProps).toBeNull();
 await render();click(checkbox('Select invoice a for payment'));await render({...baseProps,searchQuery:'new search'});expect(document.querySelector('[role=toolbar]')).toBeNull();
});
test('a refreshed fully paid row is removed from the payable selection',async()=>{
 await render();click(checkbox('Select invoice a for payment'));rows=[invoice('a','paid','0'),...rows.slice(1)];await render();expect(document.querySelector('[role=toolbar]')).toBeNull();expect(checkbox('Select invoice a for payment').disabled).toBe(true);
});
test('organization changes use the same scoped permission key as the main Invoices page and hide old entry points',async()=>{
 await render();click(checkbox('Select invoice a for payment'));activeOrgId='org-b';(apiFetch as jest.Mock).mockResolvedValue(permissions(false));await render();expect(client.getQueryData(['invoice-bulk-action-permissions','staff','org-b'])).toEqual(expect.objectContaining({payment:false}));expect(document.querySelector('[role=toolbar]')).toBeNull();expect(checkbox('Take payment for invoice a')).toBeNull();
});

test('returning to a previous Customer does not resurrect a selection or reopen a dismissed payment session',async()=>{
 await render();click(checkbox('Select invoice a for payment'));click(button('Add Payment'));await render({...baseProps,customerId:'customer-b'});expect(document.querySelector('[data-testid="existing-payment-dialog"]')).toBeNull();await render();expect(document.querySelector('[data-testid="existing-payment-dialog"]')).toBeNull();expect(document.querySelector('[role=toolbar]')).toBeNull();
});
test('payment dialog keeps its submitted IDs while refreshed invoice rows disappear, until canonical success',async()=>{
 await render();click(checkbox('Select invoice a for payment'));click(button('Add Payment'));const originalIds=paymentProps.invoiceIds;rows=[];await render();expect(document.querySelector('[data-testid="existing-payment-dialog"]')).not.toBeNull();expect(paymentProps.invoiceIds).toBe(originalIds);expect(paymentProps.invoiceIds).toEqual(['a']);
});
