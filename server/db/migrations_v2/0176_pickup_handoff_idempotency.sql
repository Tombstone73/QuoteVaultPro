-- Replay protection for immutable pickup handoffs. Existing historical rows
-- remain valid because the client request key is nullable.
ALTER TABLE "pickup_handoffs"
  ADD COLUMN "client_request_id" varchar(128);

CREATE UNIQUE INDEX "pickup_handoffs_ticket_request_uidx"
  ON "pickup_handoffs" ("organization_id", "pickup_ticket_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
