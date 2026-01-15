export type Rgb = readonly [number, number, number];

export type InvoicePdfTheme = {
  page: {
    width: number;
    height: number;
    margin: number;
  };

  colors: {
    text: Rgb;
    mutedText: Rgb;
    border: Rgb;
    tableHeaderBg: Rgb;
    jobBarBg: Rgb;

    statusPaidBg: Rgb;
    statusPartialBg: Rgb;
    statusUnpaidBg: Rgb;
    statusDraftBg: Rgb;
    statusVoidedBg: Rgb;
    statusBadgeText: Rgb;

    thumbPlaceholderBg: Rgb;
    thumbPlaceholderBorder: Rgb;
  };

  fontSizes: {
    title: number;
    h1: number;
    h2: number;
    body: number;
    small: number;
  };

  columns: {
    thumb: number;
    qty: number;
    price: number;
    gap: number;
  };

  flags: {
    showThumbnails: boolean;
    showShipTo: boolean;
    showBlindShip: boolean;
  };

  termsText?: string | null;
};

export const DEFAULT_INVOICE_PDF_THEME: InvoicePdfTheme = {
  page: {
    width: 612,
    height: 792,
    margin: 48,
  },

  colors: {
    text: [0.1, 0.1, 0.1],
    mutedText: [0.25, 0.25, 0.25],
    border: [0.85, 0.85, 0.85],
    tableHeaderBg: [0.96, 0.96, 0.97],
    jobBarBg: [0.95, 0.95, 0.96],

    statusPaidBg: [0.13, 0.65, 0.36],
    statusPartialBg: [0.96, 0.75, 0.2],
    statusUnpaidBg: [0.85, 0.22, 0.25],
    statusDraftBg: [0.45, 0.45, 0.48],
    statusVoidedBg: [0.25, 0.25, 0.27],
    statusBadgeText: [1, 1, 1],

    thumbPlaceholderBg: [0.94, 0.94, 0.95],
    thumbPlaceholderBorder: [0.85, 0.85, 0.86],
  },

  fontSizes: {
    title: 18,
    h1: 16,
    h2: 11,
    body: 10,
    small: 9,
  },

  columns: {
    thumb: 44,
    qty: 48,
    price: 90,
    gap: 10,
  },

  flags: {
    showThumbnails: true,
    showShipTo: true,
    showBlindShip: false,
  },

  termsText: null,
};
