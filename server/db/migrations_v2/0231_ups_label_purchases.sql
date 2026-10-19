-- Existing zero-dollar charges may be deliberate free shipping. Preserve every
-- historical decision; only new Orders with no entered charge start unset.
ALTER TABLE public.orders ADD COLUMN shipping_charge_decision varchar(16) NOT NULL DEFAULT 'legacy'
  CHECK (shipping_charge_decision IN ('unset','manual','free','ups_rate','legacy'));
ALTER TABLE public.orders ALTER COLUMN shipping_charge_decision SET DEFAULT 'unset';
ALTER TABLE public.orders ADD COLUMN shipping_charge_rate_quote_id varchar(64);
ALTER TABLE public.orders ADD COLUMN shipping_charge_rate_service_code varchar(8);

CREATE TABLE public.ups_shipment_rate_quotes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  request_fingerprint varchar(64) NOT NULL,
  rates jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ups_rate_quotes_org_shipment_idx ON public.ups_shipment_rate_quotes(organization_id, shipment_id);

CREATE TABLE public.ups_label_purchases (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shipment_id varchar NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  quote_id varchar NOT NULL REFERENCES public.ups_shipment_rate_quotes(id),
  status varchar(32) NOT NULL DEFAULT 'REQUESTING' CHECK (status IN ('REQUESTING','UNCERTAIN','PURCHASED','VOID_REQUESTING','VOID_UNCERTAIN','VOID_ACCEPTED','EXTERNAL_CANCEL_REPORTED','REJECTED')),
  service_code varchar(8) NOT NULL,
  service_name varchar(100) NOT NULL,
  estimate_cents integer NOT NULL CHECK (estimate_cents >= 0),
  estimate_currency varchar(3) NOT NULL,
  carrier_cost_cents integer CHECK (carrier_cost_cents >= 0),
  carrier_currency varchar(3),
  provider_shipment_id varchar(80),
  provider_transaction_id varchar(32) NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  provider_evidence jsonb,
  error_code varchar(80),
  created_by_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  purchased_at timestamptz,
  void_requested_at timestamptz,
  void_accepted_at timestamptz,
  external_canceled_at timestamptz,
  external_cancel_reason text,
  external_cancel_reference varchar(160),
  external_canceled_by_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ups_label_purchases_org_shipment_idx ON public.ups_label_purchases(organization_id, shipment_id, created_at);
CREATE UNIQUE INDEX ups_label_purchases_active_shipment_uidx ON public.ups_label_purchases(organization_id, shipment_id)
  WHERE status IN ('REQUESTING','UNCERTAIN','PURCHASED','VOID_REQUESTING','VOID_UNCERTAIN');
CREATE UNIQUE INDEX ups_label_purchases_provider_transaction_uidx ON public.ups_label_purchases(organization_id, provider_transaction_id);

CREATE TABLE public.ups_package_labels (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_id varchar NOT NULL REFERENCES public.ups_label_purchases(id) ON DELETE CASCADE,
  package_id varchar NOT NULL REFERENCES public.shipment_packages(id),
  tracking_number varchar(80) NOT NULL,
  label_format varchar(8) NOT NULL CHECK (label_format IN ('GIF')),
  label_bytes bytea NOT NULL,
  label_sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ups_package_labels_purchase_package_uidx ON public.ups_package_labels(purchase_id, package_id);
CREATE INDEX ups_package_labels_org_purchase_idx ON public.ups_package_labels(organization_id, purchase_id);

CREATE TABLE public.ups_label_purchase_orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_id varchar NOT NULL REFERENCES public.ups_label_purchases(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES public.orders(id),
  invoice_id varchar REFERENCES public.invoices(id),
  customer_shipping_charge_cents integer NOT NULL CHECK (customer_shipping_charge_cents >= 0),
  customer_charge_decision varchar(16) NOT NULL,
  invoice_shipping_cents integer CHECK (invoice_shipping_cents >= 0),
  invoice_status varchar(32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ups_purchase_orders_purchase_order_uidx ON public.ups_label_purchase_orders(purchase_id, order_id);
CREATE INDEX ups_purchase_orders_org_order_idx ON public.ups_label_purchase_orders(organization_id, order_id);

CREATE TABLE public.ups_carrier_adjustments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_id varchar NOT NULL REFERENCES public.ups_label_purchases(id),
  kind varchar(24) NOT NULL CHECK (kind IN ('CONFIRMED_CREDIT','CARRIER_ADJUSTMENT')),
  amount_cents integer NOT NULL CHECK (amount_cents <> 0 AND (kind <> 'CONFIRMED_CREDIT' OR amount_cents > 0)),
  currency varchar(3) NOT NULL,
  provider_reference varchar(160) NOT NULL,
  note text,
  recorded_by_user_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ups_carrier_adjustments_provider_uidx ON public.ups_carrier_adjustments(organization_id, purchase_id, provider_reference);
CREATE INDEX ups_carrier_adjustments_purchase_idx ON public.ups_carrier_adjustments(purchase_id);
