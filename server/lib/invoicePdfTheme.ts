export type Rgb = readonly [number, number, number];

export type PdfTextAlign = 'left' | 'center' | 'right';

export type InvoicePdfLogoMode = 'auto' | 'titan' | 'image' | 'none';

export type InvoicePdfTheme = {
  page: {
    width: number;
    height: number;
    margin: number;
  };

  fonts: {
    regular: 'Helvetica' | 'TimesRoman' | 'Courier';
    bold: 'HelveticaBold' | 'TimesRomanBold' | 'CourierBold';
  };

  spacing: {
    sectionGap: number;
    lineGap: number;
  };

  header: {
    titanMarkSize: number;
    titanWordmarkGap: number;
    titanWordmarkFontSize: number;
    titleOffsetY: number;
    statusOffsetY: number;
    metaStartOffsetY: number;
    logo: {
      mode: InvoicePdfLogoMode;
      // Data URL only (no remote fetch). If mode is 'auto' or 'image', this may be used.
      dataUrl?: string | null;
      maxWidth: number;
      maxHeight: number;
    };
    metaLineHeight: number;
    dividerGap: number;
  };

  statusBadge: {
    fontSize: number;
    paddingX: number;
    paddingY: number;
    uppercase: boolean;
    textColor: Rgb;
    backgrounds: {
      paid: Rgb;
      partial: Rgb;
      unpaid: Rgb;
      draft: Rgb;
      voided: Rgb;
    };
  };

  watermark: {
    enabled: boolean;
    mode: 'auto' | 'paid' | 'draft' | 'none';
    textPaid: string;
    textDraft: string;
    fontSize: number;
    rotationDegrees: number;
    color: Rgb;
  };

  footer: {
    enabled: boolean;
    align: PdfTextAlign;
    fontSize: number;
    color: Rgb;
    // Reserved space at the bottom of each page so content doesn't collide.
    reservedHeight: number;
    // Default footer text. Can be overridden per-render.
    text?: string | null;
  };

  tradeTerms: {
    enabled: boolean;
    title: string;
    defaultText?: string | null;
  };

  colors: {
    text: Rgb;
    mutedText: Rgb;
    border: Rgb;
    tableHeaderBg: Rgb;
    jobBarBg: Rgb;

    // Legacy status colors (retained for compatibility; statusBadge.backgrounds is preferred)
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

  // Legacy trade terms (retained for compatibility; tradeTerms.defaultText is preferred)
  termsText?: string | null;
};

export const DEFAULT_INVOICE_PDF_THEME: InvoicePdfTheme = {
  page: {
    width: 612,
    height: 792,
    margin: 48,
  },

  fonts: {
    regular: 'Helvetica',
    bold: 'HelveticaBold',
  },

  spacing: {
    sectionGap: 14,
    lineGap: 13,
  },

  header: {
    titanMarkSize: 18,
    titanWordmarkGap: 8,
    titanWordmarkFontSize: 16,
    titleOffsetY: 12,
    statusOffsetY: 26,
    metaStartOffsetY: 52,
    logo: {
      mode: 'auto',
      dataUrl: null,
      maxWidth: 160,
      maxHeight: 32,
    },
    metaLineHeight: 12,
    dividerGap: 18,
  },

  statusBadge: {
    fontSize: 9,
    paddingX: 8,
    paddingY: 4,
    uppercase: true,
    textColor: [1, 1, 1],
    backgrounds: {
      paid: [0.13, 0.65, 0.36],
      partial: [0.96, 0.75, 0.2],
      unpaid: [0.85, 0.22, 0.25],
      draft: [0.45, 0.45, 0.48],
      voided: [0.25, 0.25, 0.27],
    },
  },

  watermark: {
    enabled: true,
    mode: 'auto',
    textPaid: 'PAID',
    textDraft: 'DRAFT',
    fontSize: 80,
    rotationDegrees: 25,
    color: [0.9, 0.9, 0.9],
  },

  footer: {
    enabled: false,
    align: 'center',
    fontSize: 9,
    color: [0.4, 0.4, 0.4],
    reservedHeight: 28,
    text: null,
  },

  tradeTerms: {
    enabled: true,
    title: 'Trade Terms',
    defaultText: null,
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
