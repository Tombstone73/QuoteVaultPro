export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'dotenv' || specifier.startsWith('dotenv/')) {
    if (process.env.V2_VALIDATION_MODE !== 'db' && process.env.V2_VALIDATION_MODE !== 'qa') throw new Error('V2 deterministic validation forbids dotenv imports.');
    return { url: 'data:text/javascript,export default {}; export const config=()=>{throw new Error("dotenv loading forbidden");};', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
