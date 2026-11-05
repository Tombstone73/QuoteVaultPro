import { afterEach, expect, jest, test } from '@jest/globals';
jest.mock('@/lib/queryClient',()=>({apiRequest:jest.fn()}));
import { apiRequest } from '@/lib/queryClient';
import { closeJobOverrideRequest, CloseJobOverrideTimeout } from './closeJobOverrideRequest';
afterEach(()=>{jest.useRealTimers();jest.resetAllMocks();});
test('bounded request aborts, reports unknown outcome and never silently retries',async()=>{
  jest.useFakeTimers();jest.mocked(apiRequest).mockImplementation(()=>new Promise(()=>{}));
  const pending=closeJobOverrideRequest('POST','/synthetic',{},1000);
  const result=expect(pending).rejects.toBeInstanceOf(CloseJobOverrideTimeout);
  await jest.advanceTimersByTimeAsync(1000);await result;
  expect(jest.mocked(apiRequest).mock.calls[0]![3]?.signal?.aborted).toBe(true);expect(apiRequest).toHaveBeenCalledTimes(1);
});
test('HTTP success must also confirm the canonical operation in its response envelope',async()=>{
  jest.mocked(apiRequest).mockResolvedValue({json:async()=>({success:false,message:'Review source state'})} as Response);
  await expect(closeJobOverrideRequest('POST','/synthetic')).rejects.toThrow('Review source state');
});
