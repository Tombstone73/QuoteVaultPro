import { afterEach, expect, jest, test } from '@jest/globals';
import { carrierTrackingUrl, trackingCarrier } from '@shared/shipmentTracking';
import { fetchUpsTracking, parseUpsTracking, upsTrackingStatus } from '../services/ups/upsTracking';
import { runShipmentTrackingTick } from '../services/shipmentTrackingService';

test.each(['UPS','FedEx','USPS','DHL'])('builds a trusted %s link without accepting arbitrary URLs', carrier => {
  const url = carrierTrackingUrl(carrier, '123456789012');
  expect(url).toMatch(/^https:\/\//); expect(url).toContain('123456789012');
  expect(carrierTrackingUrl(carrier, 'javascript:alert(1)')).toBeNull();
});
test('unknown carriers, missing numbers and malicious carrier names stay unlinked', () => {
  expect(carrierTrackingUrl('Other', '123456789')).toBeNull(); expect(carrierTrackingUrl('UPS', null)).toBeNull();
  expect(trackingCarrier('https://ups.com.evil.invalid')).toBeNull(); expect(trackingCarrier('USPS')).toBe('USPS');
  expect(trackingCarrier('constructor')).toBeNull();
});
test.each([
  ['M','','Label Created','label_created'], ['I','','Carrier awaiting package','awaiting_package'],
  ['I','','On the way','in_transit'], ['I','OT','Out for Delivery','out_for_delivery'],
  ['D','','Delivered','delivered'], ['X','','Weather delay','exception'], ['?','','Unknown','unavailable'],
])('maps dated UPS status %s/%s to an honest carrier label', (type, code, text, expected) => expect(upsTrackingStatus(type,code,text)).toBe(expected));
const response = (overrides = {}) => ({ trackResponse: { shipment: [{ package: [{ trackingNumber: '1Z1234567890123456',
  deliveryDate: [{type:'SDD',date:'20261104'}], activity: [{gmtDate:'20261101',gmtTime:'74700',status:{type:'I',description:'On the way'}}], ...overrides }] }] } });
test('UPS response matches exact package, keeps carrier time/estimate, and excludes unrelated private data', () => {
  const events = parseUpsTracking(response({ packageAddress: [{addressLine1:'PRIVATE'}] }), '1Z1234567890123456');
  expect(events).toEqual([{status:'in_transit',description:'On the way',occurredAt:'2026-11-01T07:47:00.000Z',estimatedDeliveryDate:'2026-11-04'}]);
  expect(JSON.stringify(events)).not.toContain('PRIVATE'); expect(parseUpsTracking(response(), 'another-package')).toEqual([]);
});
test('undated, suppressed or invalid dates never fabricate a delivery timestamp', () => {
  expect(parseUpsTracking(response({activity:[{date:'20261101',time:'120000',status:{type:'D'}}]}), '1Z1234567890123456')).toEqual([]);
  expect(parseUpsTracking(response({suppressionIndicators:['DETAIL']}), '1Z1234567890123456')).toEqual([]);
  expect(parseUpsTracking(response({activity:[{gmtDate:'20260231',gmtTime:'120000',status:{type:'D'}}]}), '1Z1234567890123456')).toEqual([]);
});
const oldMode = process.env.UPS_ENVIRONMENT;
afterEach(() => { if(oldMode === undefined) delete process.env.UPS_ENVIRONMENT; else process.env.UPS_ENVIRONMENT=oldMode; jest.restoreAllMocks(); });
test('sandbox canned delivery data cannot become a customer observation or make a provider call', async () => {
  process.env.UPS_ENVIRONMENT='sandbox'; const network=jest.spyOn(globalThis,'fetch');
  await expect(fetchUpsTracking('org','1Z1234567890123456')).rejects.toThrow('Live UPS tracking unavailable'); expect(network).not.toHaveBeenCalled();
});
test('existing global worker kill switch prevents tracking calls even when explicitly enabled and allowlisted', async()=>{
  const names=['WORKERS_ENABLED','WORKER_SHIPMENT_TRACKING_ENABLED','SHIPMENT_TRACKING_ORGANIZATION_IDS'];
  const original=names.map(name=>process.env[name]);
  try {
    process.env.WORKERS_ENABLED='false';process.env.WORKER_SHIPMENT_TRACKING_ENABLED='true';process.env.SHIPMENT_TRACKING_ORGANIZATION_IDS='synthetic-org';
    const network=jest.spyOn(globalThis,'fetch');await runShipmentTrackingTick();expect(network).not.toHaveBeenCalled();
  } finally { names.forEach((name,index)=>{if(original[index]===undefined)delete process.env[name];else process.env[name]=original[index];}); }
});
