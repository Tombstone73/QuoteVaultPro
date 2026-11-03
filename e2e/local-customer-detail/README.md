# Customer Detail local UI checks

Run `node e2e/local-customer-detail/verify.mjs` from the repository root with the existing dependencies and Chrome installed.

The harness renders the actual `EnhancedCustomerView`, Company Form, contact controls, and portal actions. Every API call is intercepted. Company edits persist only to browser localStorage; portal transitions use fixture memory. No database, email provider, operational customer, or deployed environment is used.

Checks cover light/dark desktop and narrower layouts at normal zoom, keyboard focus, section editing, save and reload readback, and portal invite/reset/suspend/reactivate/cancel controls. Screenshots and operation evidence go to the ignored `node_modules/.cache/customer-detail-browser/` folder.

The UI uses the existing customer list read for company notes because Customer Detail's `notes` field is a note-history collection. Updates continue through the Company Form's existing customer update endpoint. An unavailable company-notes read blocks form hydration to avoid substituting note history for the company text. Art Output Folder is written through the existing destination endpoint only when deliberately edited.

The existing product setting exposed by the customer edit API is portal catalog visibility. Individual customer-visible product link records have no existing customer-detail management endpoint; this UI does not invent an assignment reader or writer.
