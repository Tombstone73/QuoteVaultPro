import { useEffect, useState, type ReactNode } from "react";
import { getArtworkObjectUrl, type ArtworkAccessVariant } from "@/lib/artworkAccess";

type AuthenticatedArtworkThumbnailProps = {
  fileRecordId: string | null | undefined;
  alt: string;
  className?: string;
  onClick?: () => void;
  fallback: ReactNode;
  variant?: Exclude<ArtworkAccessVariant, "original">;
};

/**
 * Renders a canonical artwork thumbnail through the authenticated artwork access
 * route. The object URL exists only for the lifetime of this component.
 */
export function AuthenticatedArtworkThumbnail({
  fileRecordId,
  alt,
  className,
  onClick,
  fallback,
  variant = "thumbnail",
}: AuthenticatedArtworkThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);

    if (!fileRecordId) return undefined;

    void getArtworkObjectUrl(fileRecordId, variant)
      .then((url) => {
        objectUrl = url;
        if (active) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setSrc(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileRecordId, variant]);

  if (!src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setSrc(null)}
      style={onClick ? { cursor: "pointer" } : undefined}
    />
  );
}
