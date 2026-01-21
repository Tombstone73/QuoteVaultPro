import FlatbedProductionView from "./FlatbedProductionView";

type ProductionStatus = "queued" | "in_progress" | "done";

/**
 * Roll Production View
 * Currently uses the same implementation as Flatbed (will be specialized later for roll-specific features)
 */
export default function RollProductionView(props: { viewKey: string; status: ProductionStatus }) {
  // For now, delegate to Flatbed view
  // TODO: Add roll-specific features (lamination display, roll width, run length, etc.)
  return <FlatbedProductionView {...props} />;
}
