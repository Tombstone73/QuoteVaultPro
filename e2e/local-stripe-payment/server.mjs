// Loopback-only fixture. No Stripe SDK/network, database, or real payment calls.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root = process.cwd();
const diagnostics = [];
const modules = {
  client: `const promise=Promise.resolve({});export const getStripePromise=(key)=>key?promise:null;`,
  api: `export const apiFetch=(url,options)=>fetch(url,options);`,
  stripe: `import React,{useEffect}from'react';
const stripe={confirmPayment:async()=>{window.fixtureAudit.confirms++;return{error:{type:'card_error',code:'card_declined',message:'Your card was declined.'}}}};
const elements={getElement:()=>({}),submit:async()=>{window.fixtureAudit.submits++;return{error:{type:'validation_error',code:'incomplete_expiry',message:'Your card expiration date is incomplete.'}}}};
export const useStripe=()=>stripe;export const useElements=()=>elements;export const Elements=({children})=>children;
export function PaymentElement(props){useEffect(()=>{window.fixtureAudit.mounts++;const timer=setTimeout(props.onReady,30);const changed=e=>{if(e.data==='fixture-incomplete')props.onChange({elementType:'payment',complete:false,empty:false,value:{private:'NEVER_LOG_RAW_EVENT'}});if(e.data==='fixture-complete')props.onChange({elementType:'payment',complete:true,empty:false})};window.addEventListener('message',changed);return()=>{clearTimeout(timer);window.fixtureAudit.unmounts++;window.removeEventListener('message',changed)}},[]);return React.createElement('iframe',{title:'Simulated Stripe field',src:'/fixture-field',style:{width:'100%',height:'450px',border:0}});}`,
};
const fixture = {
  name: 'isolated-payment-fixture', enforce: 'pre',
  resolveId(id) {
    const normalized = id.replaceAll('\\', '/');
    if (normalized.endsWith('/client/src/lib/stripeClient')) return '\0payment-fixture:client';
    if (normalized.endsWith('/client/src/lib/queryClient')) return '\0payment-fixture:api';
    if (id === '@stripe/react-stripe-js') return '\0payment-fixture:stripe';
  },
  load(id) { if (id.startsWith('\0payment-fixture:')) return modules[id.split(':')[1]]; },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      if (url.pathname === '/diagnostic-evidence') return json(diagnostics);
      if (url.pathname.endsWith('/diagnostics')) {
        let body = ''; for await (const chunk of req) body += chunk;
        diagnostics.push(JSON.parse(body)); res.statusCode = 204; res.end(); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname.endsWith('/runtime-config')) return json({ data: { provider: 'stripe', mode: 'test', publishableKey: 'pk_test_fixture', connectedAccountId: 'acct_fixture', readyForPayments: true } });
        if (url.pathname.endsWith('/create-intent')) return json({ data: { clientSecret: 'secret_fixture_never_log', stripeAccountId: 'acct_fixture' } });
        res.statusCode = 400; res.end('Payment operations forbidden in fixture'); return;
      }
      if (url.pathname === '/fixture-field') {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<html><body style="margin:0;font-family:sans-serif"><p>Simulated hosted field — no Stripe validation</p><label>Fixture input<input aria-label="Fixture input" style="font-size:16px;width:90%" oninput="parent.postMessage('fixture-incomplete','*')"></label><p>Benign test text only.</p><button onclick="parent.postMessage('fixture-complete','*')">Simulate complete</button><p style="margin-top:230px">Bottom of simulated hosted field</p></body></html>`); return;
      }
      if (url.pathname === '/fixture') {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/local-stripe-payment/fixture.tsx"></script></body></html>')); return;
      }
      next();
    });
  },
};
const server = await createServer({ configFile: false, root, plugins: [fixture, react()],
  resolve: { alias: { '@': path.join(root, 'client/src'), '@shared': path.join(root, 'shared') } },
  server: { host: '127.0.0.1', port: 4191, strictPort: true },
});
await server.listen();
console.log('Isolated payment fixture: http://127.0.0.1:4191/fixture');
