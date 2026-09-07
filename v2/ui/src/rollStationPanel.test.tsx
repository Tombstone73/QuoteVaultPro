import assert from "node:assert/strict";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { RollStationPanel } from "./RollStationPanel";
import type { ProductionWorkProjection } from "./api";

const unit = (
  id: string,
  side: "front" | "back",
  options: Readonly<{
    work?: Partial<ProductionWorkProjection["work"]>;
    attempts?: ProductionWorkProjection["attempts"];
    completedGoodQuantity?: number;
    unitQuantitySatisfied?: boolean;
  }> = {},
): ProductionWorkProjection => ({
  work: {
    productionWorkId: id,
    orderId: "order-1007",
    orderLineId: "line-4",
    requirement: { key: `print-${side}`, side },
    artworkAssignmentId: `assignment-${side}`,
    artworkFileId: `file-${side}`,
    orderedQuantity: 40,
    ...(options.work ?? {}),
  },
  attempts: options.attempts ?? [],
  completedGoodQuantity: options.completedGoodQuantity ?? 0,
  recordedGoodQuantity: options.completedGoodQuantity ?? 0,
  remainingGoodQuantity: 40 - (options.completedGoodQuantity ?? 0),
  unitQuantitySatisfied: options.unitQuantitySatisfied ?? false,
});

const render = (queue: readonly ProductionWorkProjection[]) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <RollStationPanel
        organizationId="org-a"
        sessionScope="session-a"
        queue={queue}
        selectedWorkId="front-work"
        onSelectWork={() => undefined}
        onOpenArtworkWorkflow={() => undefined}
      />
    </QueryClientProvider>,
  );

const doubleSided = render([
  unit("front-work", "front", { completedGoodQuantity: 12 }),
  unit("back-work", "back"),
]);
assert.match(doubleSided, /Roll production/);
assert.match(doubleSided, /Double-sided production/);
assert.match(doubleSided, />Front</);
assert.match(doubleSided, />Back</);
assert.match(doubleSided, /12/);
assert.match(doubleSided, /28/);
assert.match(doubleSided, /Open Artwork/);
assert.match(doubleSided, /Order line line-4/);
assert.match(doubleSided, /Production artwork/);
assert.doesNotMatch(doubleSided, /Customer supplied/);

const directProduction = render([
  unit("front-work", "front", {
    work: { prepressUnitId: undefined },
    attempts: [
      {
        productionAttemptId: "attempt-a",
        productionWorkId: "front-work",
        sequence: 1,
        kind: "initial",
        stationKey: "roll",
        goodQuantity: 0,
        wasteQuantity: 0,
        startedAt: "2026-09-07T12:00:00.000Z",
      },
    ],
  }),
]);
assert.match(directProduction, /Direct/);
assert.match(directProduction, /No Prepress evidence required/);
assert.match(directProduction, /In progress/);

const empty = render([]);
assert.match(empty, /No Production work is open at Roll/);

console.log("Roll station presentation contracts passed.");
