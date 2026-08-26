export type OrderRouteContext = Readonly<{
  state?: string;
  currentStepId?: string;
  currentPrerequisite?: Readonly<{ satisfied: boolean; reason?: string }>;
  steps?: readonly Readonly<{ routeInstanceStepId?: string; kind?: string }> [];
}>;
export type OrderRoutePresentation = Readonly<{
  tone: "neutral" | "active" | "blocked";
  summary: string;
  prerequisite?: string;
  reason?: string;
}>;

const label = (value?: string) => value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unavailable";

/** A read-only display of Routing-owned frozen state; it never infers eligibility. */
export const orderRoutePresentation = (route?: OrderRouteContext): OrderRoutePresentation => {
  if (!route) return { tone: "neutral", summary: "No route" };
  if (route.state === "completed") return { tone: "neutral", summary: "Route complete" };
  const current = route.steps?.find((step) => step.routeInstanceStepId === route.currentStepId);
  const summary = current ? `${label(current.kind)} · ${label(route.state)}` : `Routing · ${label(route.state)}`;
  const prerequisite = route.currentPrerequisite;
  return {
    tone: prerequisite?.satisfied === false ? "blocked" : "active",
    summary,
    ...(prerequisite ? { prerequisite: `Prerequisite: ${prerequisite.satisfied ? "Complete" : "Incomplete"}` } : {}),
    ...(!prerequisite?.satisfied && prerequisite?.reason ? { reason: prerequisite.reason } : {}),
  };
};
