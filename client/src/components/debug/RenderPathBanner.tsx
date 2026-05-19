type RenderPathBannerProps = {
  name: string;
  className?: string;
};

export function RenderPathBanner({ name, className = "" }: RenderPathBannerProps) {
  return (
    <div
      className={`rounded-md border-2 border-red-600 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-900 shadow-sm ${className}`}
      data-render-path={name}
    >
      RENDER PATH: {name}
    </div>
  );
}
