import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoicesTable } from './EnhancedCustomerView';
import InvoicesPage from '@/pages/invoices';
import { apiFetch } from '@/lib/queryClient';
import { useInvoicesPage } from '@/hooks/useInvoices';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navigate = jest.fn(), toast = jest.fn();
let cardProps: any;
let blocked = false;
const record = jest.fn();
const setInvoicePageContext = jest.fn();
let activeOrgId = 'org-a';
let globalAdmin = false;
let userRole = 'member';
let rows: any[];
const invoice = (id: string, status = 'billed', balanceDue = '50.00') => ({ id, customerId: 'customer-a', invoiceNumber: id, status, balanceDue, total: '50.00', amountPaid: '0', displayRemaining: balanceDue });
jest.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({pathname:'/invoices',search:'?customerId=customer-a'}), useSearchParams: () => { const React=require('react'); return React.useState(()=>new URLSearchParams('customerId=customer-a')); }, Link: require('react').forwardRef(({children,to,...props}:any,ref:any) => <a ref={ref} href={to} {...props}>{children}</a>) }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({user:{id:'staff',lastActiveOrgId:'org-a',role:userRole},isAdmin:globalAdmin}) }));
jest.mock('@/hooks/useActiveOrganizationRole', () => ({useActiveOrganizationRole: () => ({activeOrgId,isAdminOrOwner:false})}));
jest.mock('@/hooks/useInvoices', () => ({useInvoicesPage:jest.fn(),useApproveInvoicesForAccounting:()=>({isPending:false,mutateAsync:jest.fn()}),useBatchSendInvoices:()=>({isPending:false}),useBulkMarkInvoicesSent:()=>({isPending:false}),useResolveInvoiceEmailDeliveryReview:()=>({isPending:false}),useInvoiceEmailQueue:()=>({data:undefined}),useRecordCustomerInvoicePayment:()=>({isPending:false,mutate:record})}));
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


jest.mock('@/features/assistant/AssistantWorkspaceProvider',()=>({useAssistantWorkspace:()=>({setInvoicePageContext})}));
jest.mock('@/components/InvoiceCustomerReleaseAction',()=>({InvoiceCustomerReleaseAction:()=>null}));
jest.mock('@/components/CustomerMultiSelect',()=>({CustomerMultiSelect:()=>null}));
jest.mock('@/components/invoices/InvoiceEmailQueueDialog',()=>({InvoiceEmailQueueDialog:()=>null}));
jest.mock('@/components/invoices/InvoiceEmailSendDialog',()=>({InvoiceEmailSendDialog:()=>null}));
jest.mock('@/components/payments/StripePayDialog',()=>({__esModule:true,default:(props:any)=>{cardProps=props;return <div data-testid="stripe-checkout">Existing Stripe dialog</div>;}}));
jest.mock('@/components/ui/select',()=>({Select:({children,value,onValueChange}:any)=><select value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>,SelectTrigger:()=>null,SelectValue:()=>null,SelectContent:({children}:any)=><>{children}</>,SelectItem:({children,value}:any)=><option value={value}>{children}</option>}));
let root:Root,client:QueryClient;
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(node=>node.textContent===label)!;
const click=(element:HTMLElement)=>act(()=>element.click());
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});};
beforeEach(()=>{
 jest.clearAllMocks();window.localStorage.clear();blocked=false;cardProps=null;rows=[invoice('a'),invoice('b')];
 Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=> 'synthetic-reviewed-key'});jest.spyOn(window,'confirm').mockReturnValue(true);
 (useInvoicesPage as jest.Mock).mockReturnValue({isLoading:false,data:{items:rows,pagination:{page:1,pageSize:50,totalCount:2,totalPages:1},summary:{totalOutstandingCents:10000,totalInvoices:2,overdueCount:0,paidThisMonthCents:0}}});
 (apiFetch as jest.Mock).mockImplementation(async(path,options)=>{
  if(path==='/api/invoices/bulk-action-permissions')return {ok:true,json:async()=>({data:{payment:true,send:false,markSent:false,approve:false}})};
  if(path.endsWith('/runtime-config'))return {ok:true,status:200,json:async()=>({data:{provider:'stripe',mode:'test',publishableKey:'pk_test_synthetic',connectedAccountId:'acct_synthetic',readyForPayments:true}})};
  if(path.endsWith('/preview')){
   if(blocked)return {ok:false,status:409,json:async()=>({code:'ORDER_NOT_FOUND',error:'The invoice order is unavailable.',blockedInvoice:{invoiceId:'b',invoiceNumber:'B'}})};
   const ids=JSON.parse(options.body).invoiceIds;return {ok:true,json:async()=>({data:{customerId:'customer-a',selectedCount:ids.length,eligibleCount:ids.length,excludedCount:0,totalOutstandingCents:ids.length*5000,invoices:ids.map((id:string)=>({invoiceId:id,invoiceNumber:id,remainingCents:5000})),allocations:[]}})};
  }
  throw new Error('Unexpected payment request: '+path);
 });
 const host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{act(()=>root.unmount());client.clear();document.body.innerHTML='';jest.restoreAllMocks();});
async function openPayment(entry:'Customer'|'Invoices'){
 await act(async()=>root.render(<QueryClientProvider client={client}>{entry==='Customer'?<InvoicesTable customerId="customer-a" searchQuery="" statusFilter="all"/>:<InvoicesPage/>}</QueryClientProvider>));await flush();
 const labels=entry==='Customer'?['Select invoice a for payment','Select invoice b for payment']:['Select invoice a','Select invoice b'];
 for(const label of labels)click(document.querySelector('[aria-label="'+label+'"]')!);
 click(button('Add Payment'));await flush();await flush();
}
test.each(['Customer','Invoices'] as const)('%s mounted entry uses the same valid selection, shared preview and configured grouped Stripe entry',async entry=>{
 await openPayment(entry);expect(document.body.textContent).toContain('2 payable invoices');expect(document.body.textContent).toContain('$100.00');
 const calls=(apiFetch as jest.Mock).mock.calls.filter(([path])=>path.endsWith('/preview'));expect(calls).toHaveLength(1);expect(JSON.parse(calls[0][1].body)).toMatchObject({invoiceIds:['a','b'],allocationMode:'oldest_first'});
 const method=Array.from(document.querySelectorAll('select')).find(select=>Array.from(select.options).some(option=>option.value==='credit_card'))!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(method,'credit_card');method.dispatchEvent(new Event('change',{bubbles:true}));});await flush();
 expect(button('Continue to Card Payment').disabled).toBe(false);click(button('Continue to Card Payment'));await flush();expect(cardProps).toMatchObject({groupedInitiation:true,invoiceIds:['a','b'],groupedApiBasePath:'/api/invoices/customer-payment/stripe'});expect(record).not.toHaveBeenCalled();expect(toast).not.toHaveBeenCalled();
});
test.each(['Customer','Invoices'] as const)('%s mounted entry identifies a blocked Invoice and permits retry/selection correction without initiating payment',async entry=>{
 blocked=true;await openPayment(entry);expect(document.querySelector('[role=alert]')?.textContent).toContain('Invoice B cannot be included');expect(document.body.textContent).toContain('linked Order could not be verified');expect(button('Record Payment').disabled).toBe(true);expect(record).not.toHaveBeenCalled();expect(cardProps).toBeNull();
 blocked=false;click(button('Refresh preview'));await flush();await flush();expect(document.body.textContent).toContain('2 payable invoices');expect(toast).not.toHaveBeenCalled();click(button('Cancel'));await flush();expect(document.body.textContent).not.toContain('Add Customer Payment');
});
