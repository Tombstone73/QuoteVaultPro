import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { test, expect, jest } from '@jest/globals';
const api=jest.fn<typeof fetch>();
jest.mock('@/lib/apiConfig',()=>({getApiUrl:(path:string)=>path}));
jest.mock('@/lib/queryClient',()=>({apiFetch:(...args:Parameters<typeof fetch>)=>api(...args)}));
jest.mock('@/hooks/use-toast',()=>({clearNotificationSession:jest.fn()}));
import { NavigationGuardContext } from '@/contexts/navigationGuardRegistration';
import { useLogout } from './useAuth';
test('logout waits for the shared discard decision and clears business cache only after it is allowed',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const client=new QueryClient(),host=document.createElement('div'),root=createRoot(host);document.body.append(host);
  let allowed=false;
  client.setQueryData(['protected-records'],{id:'synthetic'});
  const guard={requestExit:async()=>allowed,registerGuard:()=>()=>{},guardedNavigate:()=>{},isGuardActive:()=>true,getGuardDiagnostics:()=>({registeredGuardCount:1,guards:[],activeGuardLabels:['dirty']} )};
  function Control(){const logout=useLogout();return <button onClick={()=>void logout()}>Logout</button>;}
  const consoleError=jest.spyOn(console,'error').mockImplementation(()=>{});
  try{
    api.mockResolvedValue({ok:true} as Response);
    await act(async()=>root.render(<QueryClientProvider client={client}><NavigationGuardContext.Provider value={guard}><Control/></NavigationGuardContext.Provider></QueryClientProvider>));
    await act(async()=>host.querySelector('button')!.click());expect(api).not.toHaveBeenCalled();expect(client.getQueryData(['protected-records'])).toBeDefined();
    allowed=true;await act(async()=>host.querySelector('button')!.click());expect(api).toHaveBeenCalledWith(expect.stringContaining('/api/auth/logout'),expect.objectContaining({method:'POST'}));expect(client.getQueryData(['protected-records'])).toBeUndefined();
  }finally{act(()=>root.unmount());host.remove();client.clear();consoleError.mockRestore();}
});
