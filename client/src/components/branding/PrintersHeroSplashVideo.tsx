import type { VideoHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { SPLASH_MP4_SRC, SPLASH_WEBM_SRC } from "@/lib/branding";

type PrintersHeroSplashVideoProps = Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "autoPlay" | "muted" | "playsInline"
> & {
  fadeOut?: boolean;
};

export function PrintersHeroSplashVideo({
  fadeOut = false,
  className,
  ...props
}: PrintersHeroSplashVideoProps) {
  return (
    <video
      {...props}
      autoPlay
      muted
      playsInline
      preload="auto"
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(
        "transition-opacity duration-500 ease-out",
        fadeOut ? "pointer-events-none opacity-0" : "opacity-100",
        className,
      )}
    >
      <source src={SPLASH_WEBM_SRC} type="video/webm" />
      <source src={SPLASH_MP4_SRC} type="video/mp4" />
    </video>
  );
}

export default PrintersHeroSplashVideo;
