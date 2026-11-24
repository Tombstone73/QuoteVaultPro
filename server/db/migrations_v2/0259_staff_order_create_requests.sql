CREATE TABLE public.staff_order_create_requests (
    organization_id varchar NOT NULL,
    actor_user_id varchar NOT NULL,
    operation varchar(32) NOT NULL,
    key_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    order_id varchar NOT NULL,
    follow_up_verified boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT staff_order_create_requests_pk PRIMARY KEY (organization_id, actor_user_id, operation, key_hash)
);
