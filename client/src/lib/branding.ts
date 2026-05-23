export const BRAND_ASSET_VERSION = "ph-20260523";

export function brandAssetUrl(filename: string): string {
  return `/branding/${filename}?v=${BRAND_ASSET_VERSION}`;
}

export const HERO_LOGO_SRC = brandAssetUrl("hero-logo.png");
export const SHIELD_LOGO_SRC = brandAssetUrl("shield-logo.svg");
export const SPLASH_WEBM_SRC = brandAssetUrl("printers-hero-splash.webm");
export const SPLASH_MP4_SRC = brandAssetUrl("printers-hero-splash.mp4");
