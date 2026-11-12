ALTER TABLE public.customer_contact_links
  ADD COLUMN portal_access_role varchar(40),
  ADD CONSTRAINT customer_contact_links_portal_role_check
    CHECK (portal_access_role IN ('COMPANY_ADMIN', 'BUYER', 'BILLING', 'VIEWER'));
--> statement-breakpoint
CREATE FUNCTION public.assign_company_contact_portal_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'removed' THEN
    RETURN NEW;
  END IF;

  -- Serialize additions for this company. A weaker lock than FOR UPDATE is
  -- sufficient and remains compatible with foreign-key key-share locks.
  PERFORM 1 FROM public.customers
    WHERE id = NEW.customer_id AND organization_id = NEW.organization_id
    FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.customer_contacts
      WHERE id = NEW.contact_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'Company contact relationship must stay in the same organization'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.portal_access_role IS NULL THEN
    NEW.portal_access_role := CASE WHEN EXISTS (
      SELECT 1 FROM public.customer_contact_links AS link
      JOIN public.customer_contacts AS contact
        ON contact.id = link.contact_id AND contact.organization_id = link.organization_id
      WHERE link.organization_id = NEW.organization_id
        AND link.customer_id = NEW.customer_id AND link.status <> 'removed'
    ) THEN 'BUYER' ELSE 'COMPANY_ADMIN' END;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER customer_contact_links_assign_portal_role
  BEFORE INSERT ON public.customer_contact_links
  FOR EACH ROW EXECUTE FUNCTION public.assign_company_contact_portal_role();
