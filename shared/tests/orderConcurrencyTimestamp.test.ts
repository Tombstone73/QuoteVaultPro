import { canonicalOrderConcurrencyTimestamp as normalize } from '../orderConcurrencyTimestamp';
import { createRedoOrderSchema } from '../orderRedo';
test.each([
 ['2026-10-01 17:37:13.418115','2026-10-01T17:37:13.418115Z'],
 ['2026-10-01T19:37:13.418115+02:00','2026-10-01T17:37:13.418115Z'],
 ['2026-10-01T17:37:13.418000Z','2026-10-01T17:37:13.418Z'],
 [new Date('2026-10-01T17:37:13.418Z'),'2026-10-01T17:37:13.418Z'],
 ['2026-10-01 17:37:13','2026-10-01T17:37:13.000Z'],
])('normalizes known source representation %s without dropping available precision',(input,expected)=>expect(normalize(input)).toBe(expected));
test.each([undefined,null,'','10/01/2026 17:37','2026-10-01T17:37:13','2026-02-30 17:37:13','invalid','2026-10-01T17:37:13.1234567Z'])('fails closed for missing, ambiguous or invalid source timestamp %s',input=>expect(normalize(input)).toBeNull());
test('promised date is independent from the exact optimistic concurrency instant',()=>{
 const token=normalize('2026-10-01 17:37:13.418115');
 const result=createRedoOrderSchema.safeParse({requestKey:'10000000-0000-4000-8000-000000000001',expectedUpdatedAt:token,lines:[{sourceLineItemId:'synthetic',quantity:1,expectedUpdatedAt:token}],reason:'Print quality',explanation:'',promisedDate:'2026-10-30',disposition:'no_customer_charge',confirmed:true});
 expect(result.success).toBe(true);
});
