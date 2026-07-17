export type PrepressArtworkSide = "front" | "back" | "both" | "na";

export function formatPrepressArtworkSide(side: PrepressArtworkSide): string {
  if (side === "front") return "Front";
  if (side === "back") return "Back";
  if (side === "both") return "Both";
  return "Unassigned";
}

export function PrepressArtworkSideBadge({ side }: { side: PrepressArtworkSide }) {
  return (
    <span
      className="bg-violet-900/50 text-violet-200 border border-violet-700/40 px-2 py-0.5 rounded text-[9px] font-bold uppercase"
      data-testid={`prepress-artwork-side-${side}`}
    >
      {formatPrepressArtworkSide(side)}
    </span>
  );
}

