# Focused UI usability corrections

## Causes and boundaries

- Inbound queue loading included `isFetching`, replacing rows on every refetch. Only initial loading now replaces rows. Existing draft ownership and query caches are retained.
- Customer Edit owns its React Hook Form dirty baseline. Update success did not reset that baseline; rejected `mutateAsync` also escaped the event handler. Confirmed saves reset the submitted baseline and close the dialog; failures keep edits and report an error. Inputs are disabled during submission so later edits cannot be mistaken for saved values. No navigation guard was weakened. The repository Customer Edit uses explicit Save, not status autosave; a separate live autosave trigger was not established.
- Shared deadline mode/time controls now occupy a row below the date, wrapping independently.
- Customers uses the available page width. Proofing header actions wrap and its side columns shrink on narrower desktop screens.
- Inbound explicitly forced `dark` on its workstation. That override is removed. Application-owned Inbound, Prepress, and Proofing surfaces, labels, borders and semantic helper text now support light/dark themes. Original document content is unchanged.
- Order-aware download labels reuse the existing filename prefix resolver. Canonical Order numbers come from the current authorized record; storage keys, file IDs and source filenames are unchanged. Existing prefixes are not duplicated; unsaved/Quote files without an Order number retain their names.
- Both Printer Picker dialog entry points now have bounded height and scrolling, matching Settings. The existing sticky form actions remain visible.
- Settings uses canonical soft archive instead of offering destructive Delete. Archiving clears active/default state without removing profiles or historical/queued job references. Backend persistence/permissions and worker claims are unchanged.
- Print Agent 1.0.31 reports five installer stages, bounded 30-second API waits and connection-confirmation attempts. Its executable now embeds the existing branded tray icon as its Windows application icon. The existing tray already used that embedded branding. No new service/controller architecture was added.

## Validation and remaining acceptance

Focused component tests cover failed/confirmed customer saves, dirty-state retention, delayed inbound list refetch with actual node/scroll retention, shared deadline layout/semantics, authenticated downloads and duplicate-free naming, printer dialogs and archive UI. Installer contracts, C# connection/dispatcher/icon checks, PowerShell syntax, and an actual self-contained Windows publish/package were checked.

Local browser fixtures exercise actual components at normal zoom in light/dark themes and desktop/narrow viewports. They include delayed background import refresh, dirty inputs and scroll, customer save/reload and portal controls, full-width Customers, printer dialog scrolling/archive, Prepress and Proofing. HTTP persistence is mocked. No operational customer, printer, mailbox, shipment or proof records were changed.

No schema or database persistence contract changed, so PostgreSQL suites were not required. No live DEV/MAIN or physical printer validation occurred. Cloud deployment does not update installed agents; a deliberate workstation upgrade and tray/installer acceptance remain outstanding. The separate reported customer status autosave event needs live confirmation if it occurs outside Customer Edit.

Deployable but not yet live-validated.
