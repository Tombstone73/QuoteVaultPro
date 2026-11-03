# Editor workspace isolation — Milestone 1

`WorkspaceBoundary` owns a lifetime-stable identity, activity, DOM root, portal
container, route snapshot, and scroll position. Normal Order, Quote, and Customer
routes use `SingleEditorWorkspace`; it preserves their existing DOM IDs and
BrowserRouter navigation. There is no application tab bar in this milestone.

## Contract for the future workspace host

- Mount each editor once with a unique, stable `workspaceId` and React key. Hide
  inactive editors using `active`, without unmounting or reusing another editor's
  key. Editor state and canonical save/pricing services remain where they are.
- Supply `route` and `onNavigate` for independently routed workspaces. The
  callback updates **only that workspace**, including late save completions; it
  must not activate another editor or navigate the global browser implicitly.
  The host will own the workspace history stack and browser-history mapping.
- Use `scrollMode="contained"` with an explicit viewport height for independent
  scroll containers. Document scrolling remains available for ordinary routes.
- Use workspace routing hooks/links, field IDs and DOM lookup helpers. New native
  fields must scope both their IDs and label/ARIA references. Shared form
  controls already do this. Generated React/Radix IDs remain intact.
- Keep dialogs and popovers on the shared primitives. Their live portals belong
  to the active boundary. Inactive content is detached while retaining its React
  form state; Radix modal focus/pointer/scroll locks are released. Menus and
  confirmation dialogs unmount their interactive content while inactive.
- Register unsaved changes through the shared navigation guard. Local navigation
  checks its owner's guards; leaving the entire host checks every dirty editor,
  including inactive editors. Browser refresh/close warnings remain enabled for
  unsaved work. Existing BrowserRouter Back/Forward behavior is preserved; it is
  not a synchronous POP blocker.

The existing Quote editor dirty/discard snapshot now starts before the first
save, so new Orders and Quotes are protected too. No second draft buffer or
draft persistence path is introduced. Unsaved data is memory-only and may be lost
after a deliberately confirmed refresh/close. Session storage holds only the
existing pending scroll/expansion navigation metadata, namespaced by workspace.

## Validation

- `WorkspaceContext.esm.test.tsx`: two editor instances, scoped fields/focus,
  local routing/params/search, guards, refresh protection, modal/popover/select
  deactivation, retained form state, scroll/expansion isolation, normal navigation.
- Existing Quote editor hook regression: independent dirty baselines before
  first save, saved edits, failed saves, and edits during an in-flight save.
- Focused shared editor, PBV2, customer/contact, Customer Detail, fulfillment and
  navigation tests cover the affected single-editor paths.
- `node e2e/local-workspace-isolation/verify.mjs`: real shared New Order instances,
  Quote editor and Customer form with synthetic HTTP responses. Exercises dirty
  state, product/dimension/quantity/pricing retention, focus, dialogs, scroll,
  browser navigation, light/dark themes and narrow desktop at normal zoom.

Browser fixture persistence is mocked. No database, storage, production data,
Gmail settings, or backend contracts are changed or live-validated here. The
visible tab manager, saved-record tab reuse, close-tab UI, and workspace history
coordination remain future work.
