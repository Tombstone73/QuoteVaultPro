import { getFulfillmentWorkspaceLoadState } from './fulfillmentWorkspaceState';

describe('getFulfillmentWorkspaceLoadState', () => {
  const orderId = '1f8a7648-89d0-406f-808c-06324b09a819';

  it('keeps a valid workspace ready even when all child fulfillment state is empty', () => {
    expect(getFulfillmentWorkspaceLoadState({ orderId, isLoading: false, isError: false, hasDetail: true })).toBe('ready');
  });

  it('renders not found only for a missing route identity or a true 404', () => {
    expect(getFulfillmentWorkspaceLoadState({ orderId: undefined, isLoading: false, isError: false, hasDetail: false })).toBe('not_found');
    expect(getFulfillmentWorkspaceLoadState({ orderId, isLoading: false, isError: true, errorStatus: 404, hasDetail: false })).toBe('not_found');
  });

  it('keeps schema and server failures visible instead of converting them to not found', () => {
    expect(getFulfillmentWorkspaceLoadState({ orderId, isLoading: false, isError: true, errorStatus: 500, hasDetail: false })).toBe('error');
  });
});
