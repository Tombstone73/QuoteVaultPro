import { expect, jest, test } from '@jest/globals';
import { productionOverrideRetryError, productionOverrideTiming } from '../services/orderProductionOverrideBoundary';
test.each(['55P03','40P01','57014'])('database %s returns sanitized rollback and explicit safe retry guidance',code=>{
  const result=productionOverrideRetryError({cause:{cause:{code,message:'private SQL and business data'}}});
  expect(result).toMatchObject({status:409,retryable:true,committed:false});expect(JSON.stringify(result)).not.toContain('private SQL');
});
test('timing diagnostics have fixed stages and no request contents or error details',async()=>{
  const info=jest.spyOn(console,'info').mockImplementation(()=>{});
  try {
    const timer=productionOverrideTiming();await timer.run('bootstrap',async()=>1);await timer.run('bootstrap',async()=>2);
    timer.finish({organizationId:'org',orderId:'order',status:200});
    expect(info).toHaveBeenCalledWith('[OrderProductionOverrideTiming]',expect.objectContaining({stages:{bootstrap:{calls:2,durationMs:expect.any(Number)}}}));
  } finally {info.mockRestore();}
});
