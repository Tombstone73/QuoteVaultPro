import { assertVercelUiRoutingEnvironment } from "../src/deploymentRouting";

// This command intentionally has no network or provider calls. On Vercel, it
// rejects missing/ambiguous routing variables before the SPA is built.
assertVercelUiRoutingEnvironment(process.env);
