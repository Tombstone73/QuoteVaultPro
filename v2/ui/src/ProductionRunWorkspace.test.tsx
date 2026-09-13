import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionRunEventHistory } from "./ProductionRunWorkspace";

const markup = renderToStaticMarkup(<ProductionRunEventHistory events={[
  { productionRunEventId: "event-1", sequence: 1, kind: "created", createdAt: "2026-09-13T12:00:00.000Z", createdPrincipalSubject: "operator-a" },
  { productionRunEventId: "event-2", sequence: 2, kind: "artwork_refreshed", createdAt: "2026-09-13T12:01:00.000Z", createdPrincipalSubject: "operator-a", reason: "New production artwork" },
  { productionRunEventId: "event-3", sequence: 3, kind: "good_output", createdAt: "2026-09-13T12:02:00.000Z", createdPrincipalSubject: "operator-b", note: "40 good" },
  { productionRunEventId: "event-4", sequence: 4, kind: "member_released", createdAt: "2026-09-13T12:03:00.000Z", createdPrincipalSubject: "operator-b" },
  { productionRunEventId: "event-5", sequence: 5, kind: "completed", createdAt: "2026-09-13T12:04:00.000Z", createdPrincipalSubject: "operator-b" },
] as never} />);

for (const text of ["Run history", "Run created", "Artwork preparation refreshed", "Good output recorded", "Member released", "Run completed", "operator-a", "New production artwork", "40 good"]) assert.match(markup, new RegExp(text));
assert.match(markup, /#1[\s\S]*#2[\s\S]*#3[\s\S]*#4[\s\S]*#5/, "events render in authoritative sequence order");
console.log("Production Run history UI contract passed.");
