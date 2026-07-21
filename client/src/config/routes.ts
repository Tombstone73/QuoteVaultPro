/**
 * Central Route Configuration for TitanOS
 * 
 * This file defines all application routes in a type-safe, centralized way.
 * All navigation should use these route builders instead of hardcoded strings.
 * 
 * ROUTE TABLE (from App.tsx):
 * ================================
 * 
 * ROOT & DASHBOARD:
 * - / → public landing page
 * - /dashboard → Home
 * 
 * PORTAL (Customer-Facing):
 * - /portal/my-quotes → MyQuotes
 * - /portal/my-orders → MyOrders
 * - /portal/quotes/:id/checkout → QuoteCheckout
 * 
 * QUOTES:
 * - /quotes → InternalQuotes (list)
 * - /quotes/new → QuoteEditor (create)
 * - /quotes/:id → QuoteDetail (view)
 * - /quotes/:id/edit → EditQuote (edit)
 * - /my-quotes → CustomerQuotes (legacy customer quotes)
 * 
 * ORDERS:
 * - /orders → Orders (list)
 * - /orders/new → OrderNewRoute (create via quote editor + convert)
 * - /orders/:id → OrderDetail (view)
 * - /orders/:id/edit → OrderDetail (edit)
 * 
 * CUSTOMERS:
 * - /customers → Customers (list)
 * - /customers/:id → CustomerDetail (view)
 * 
 * CONTACTS:
 * - /contacts → Contacts (list)
 * - /contacts/:id → ContactDetail (view)
 * 
 * MATERIALS / INVENTORY:
 * - /materials → MaterialsListPage (list)
 * - /materials/:id → MaterialDetailPage (view)
 * 
 * VENDORS:
 * - /vendors → VendorsPage (list)
 * - /vendors/:id → VendorDetailPage (view)
 * 
 * PURCHASE ORDERS:
 * - /purchase-orders → PurchaseOrdersPage (list)
 * - /purchase-orders/:id → PurchaseOrderDetailPage (view)
 * - /purchase-orders/new → PurchaseOrderNewPage (create)
 * 
 * INVOICES:
 * - /invoices → InvoicesListPage (list)
 * - /invoices/:id → InvoiceDetailPage (view)
 * 
 * PRODUCTION:
 * - /production → ProductionBoard (kanban view)
 * - /jobs/:id → JobDetail (job detail)
 * 
 * PRODUCTS & ADMIN:
 * - /products → ProductsPage (catalog)
 * - /admin → Admin (admin home)
 * - /admin/users → AdminUsers (user management)
 * - /admin/products → ProductsPage (product admin)
 * - /admin/product-types → ProductTypesSettings
 * - /users → UserManagement (user list)
 * 
 * SETTINGS (nested under SettingsLayout):
 * - /settings → CompanySettings (default)
 * - /settings/company → CompanySettings
 * - /settings/users → UsersSettings
 * - /settings/products → ProductsPage
 * - /settings/product-types → ProductTypesSettings
 * - /settings/pricing-formulas → PricingFormulasSettings
 * - /settings/integrations → SettingsIntegrations
 * - /settings/production → ProductionSettings
 * - /settings/inventory → InventorySettings
 * - /settings/notifications → NotificationsSettings
 * - /settings/appearance → AppearanceSettings
 * 
 * MISC:
 * - /debug-user → DebugUser
 * 
 * REFERENCED IN NAV BUT NOT IMPLEMENTED:
 * - /fulfillment → [TODO: Route missing, nav item exists]
 * - /reports → [TODO: Route missing, nav item exists]
 * 
 * DEAD / UNUSED ROUTES:
 * - None identified yet
 */

export const ROUTES = {
  // Root & Dashboard
  root: "/",
  titanDashboard: "/dashboard",
  dashboard: "/dashboard",

  // Portal (customer-facing)
  portal: {
    myQuotes: "/portal/my-quotes",
    myOrders: "/portal/my-orders",
    quoteCheckout: (quoteId: string) => `/portal/quotes/${quoteId}/checkout`,
  },

  // Quotes
  quotes: {
    list: "/quotes",
    detail: (id: string) => `/quotes/${id}`,
    edit: (id: string) => `/quotes/${id}/edit`,
    new: "/quotes/new",
  },
  
  // Legacy customer quotes
  myQuotes: "/my-quotes",

  // Orders
  orders: {
    list: "/orders",
    new: "/orders/new",
    detail: (id: string) => `/orders/${id}`,
    edit: (id: string) => `/orders/${id}/edit`,
    traveler: (id: string) => `/orders/${id}/traveler`,
  },

  inboundOrders: {
    list: "/inbound-orders",
  },

  productPlanning: {
    root: "/product-planning",
    dashboard: "/product-planning/dashboard",
    backlog: "/product-planning/backlog",
    kanban: "/product-planning/kanban",
    roadmap: "/product-planning/roadmap",
    imports: "/product-planning/imports",
    workItemDetail: (id: string) => `/product-planning/work-items/${id}`,
  },

  // Customers
  customers: {
    list: "/customers",
    portalAccess: "/customers/portal-access",
    detail: (id: string) => `/customers/${id}`,
  },

  // Contacts
  contacts: {
    list: "/contacts",
    detail: (id: string) => `/contacts/${id}`,
  },

  // Materials / Inventory
  materials: {
    list: "/materials",
    detail: (id: string) => `/materials/${id}`,
  },

  // Vendors
  vendors: {
    list: "/vendors",
    detail: (id: string) => `/vendors/${id}`,
  },

  // Purchase Orders
  purchaseOrders: {
    list: "/purchase-orders",
    new: "/purchase-orders/new",
    detail: (id: string) => `/purchase-orders/${id}`,
  },

  // Invoices
  invoices: {
    list: "/invoices",
    detail: (id: string) => `/invoices/${id}`,
  },

  // Production
  production: {
    board: "/production",
    design: "/production/design",
    proofing: "/production/proofing",
    prepress: "/production/prepress",
    flatbed: "/production/flatbed",
    roll: "/production/roll",
    jobDetail: (jobId: string) => `/production/jobs/${jobId}`,
    jobTicket: (jobId: string) => `/production/jobs/${jobId}/ticket`,
  },
  
  jobs: {
    detail: (id: string) => `/jobs/${id}`,
  },

  // Products & Admin
  products: {
    list: "/products",
  },
  
  admin: {
    home: "/admin",
    users: "/admin/users",
    products: "/admin/products",
    productTypes: "/admin/product-types",
    bugReports: "/admin/bug-reports",
    catalogMigrationLab: "/admin/catalog-migration-lab",
    aiProductBuilder: "/admin/catalog-migration-lab?mode=ai-product-builder",
    productIntakeReview: (sessionId: string) => `/admin/product-intake/sessions/${sessionId}/review`,
    pricingAudit: "/admin/pricing-audit",
    materialsImportExport: "/admin/materials/import-export",
  },

  developer: {
    qbInvoiceInspector: "/admin/developer/qb-invoice-inspector",
    qbCustomerInspector: "/admin/developer/qb-customer-inspector",
    customerContactMigration: "/admin/developer/customer-contact-migration",
  },

  platform: {
    tools: "/platform/tools",
    orgsNew: "/platform/orgs/new",
  },

  system: {
    adminDashboard: "/system/admin",
  },
  
  users: {
    list: "/users",
  },

  // Settings (nested routes)
  settings: {
    root: "/settings",
    company: "/settings/company",
    customerPortal: "/settings/customer-portal",
    users: "/settings/users",
    products: "/settings/products",
    productTypes: "/settings/product-types",
    pricingFormulas: "/settings/pricing-formulas",
    integrations: "/settings/integrations",
    production: "/settings/production",
    inventory: "/settings/inventory",
    notifications: "/settings/notifications",
    appearance: "/settings/appearance",
    setup: "/settings/setup",
  },

  // TODO: These routes are referenced in nav but not implemented
  fulfillment: {
    list: "/fulfillment",
    shipmentDetail: (shipmentId: string) => `/fulfillment/shipments/${shipmentId}`,
  },
  labels: "/shipping",
  reports: "/reports",
  finance: "/payments",

  // Misc
  debugUser: "/debug-user",
} as const;
