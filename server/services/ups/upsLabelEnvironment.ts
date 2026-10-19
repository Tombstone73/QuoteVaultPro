export type UpsLabelEnvironment = 'unknown' | 'test' | 'live';

/** UPS CIE's documented sample tracking value must never authorize dispatch. */
export const isUpsPlaceholderTracking = (tracking: string | null | undefined): boolean =>
  tracking?.trim().toUpperCase() === '1ZXXXXXXXXXXXXXXXX';

export const isDispatchableUpsLabel = (environment: UpsLabelEnvironment, tracking: string | null | undefined): boolean =>
  environment === 'live' && Boolean(tracking) && !isUpsPlaceholderTracking(tracking);

export const isOriginalUpsEnvironment = (purchase: UpsLabelEnvironment, connection: 'test' | 'live'): boolean =>
  purchase !== 'unknown' && purchase === connection;
