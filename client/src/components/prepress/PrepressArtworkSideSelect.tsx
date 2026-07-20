import { PrepressArtworkSideBadge } from "@/components/prepress/PrepressArtworkSideBadge";

export type PrepressAssignableArtworkSide = "front" | "back" | "both";

export function PrepressArtworkSideSelect(props: {
  filename: string;
  side: PrepressAssignableArtworkSide | "na";
  disabled?: boolean;
  onAssign: (side: PrepressAssignableArtworkSide) => void;
}) {
  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <PrepressArtworkSideBadge side={props.side} />
      <select
        aria-label={`Assign artwork side for ${props.filename}`}
        className="h-7 rounded border border-slate-600 bg-[#111921] px-2 text-[11px] text-slate-200"
        value={props.side === "na" ? "" : props.side}
        disabled={props.disabled}
        onChange={(event) => {
          const side = event.target.value as PrepressAssignableArtworkSide;
          if (side) props.onAssign(side);
        }}
      >
        <option value="">Assign side</option>
        <option value="front">Front</option>
        <option value="back">Back</option>
        <option value="both">Both</option>
      </select>
    </div>
  );
}
