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
 * - / → redirect to /dashboard
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
 * - /orders/new → CreateOrder (create)
 * - /orders/:id → OrderDetail (view)
 * - /orders/:id/edit → [TODO: NOT IMPLEMENTED - referenced but missing]
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
 * - /purchase-orders/new → [TODO: NOT IMPLEMENTED - referenced in vendor-detail but missing]
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
    // TODO: /orders/:id/edit not implemented but may be needed
    // edit: (id: string) => `/orders/${id}/edit`,
  },

  // Customers
  customers: {
    list: "/customers",
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
    detail: (id: string) => `/purchase-orders/${id}`,
    // TODO: /purchase-orders/new not implemented but referenced in vendor-detail
    // new: "/purchase-orders/new",
  },

  // Invoices
  invoices: {
    list: "/invoices",
    detail: (id: string) => `/invoices/${id}`,
  },

  // Production
  production: {
    board: "/production",
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
  },
  
  users: {
    list: "/users",
  },

  // Settings (nested routes)
  settings: {
    root: "/settings",
    company: "/settings/company",
    users: "/settings/users",
    products: "/settings/products",
    productTypes: "/settings/product-types",
    pricingFormulas: "/settings/pricing-formulas",
    integrations: "/settings/integrations",
    production: "/settings/production",
    inventory: "/settings/inventory",
    notifications: "/settings/notifications",
    appearance: "/settings/appearance",
  },

  // TODO: These routes are referenced in nav but not implemented
  // fulfillment: "/fulfillment",
  // reports: "/reports",

  // Misc
  debugUser: "/debug-user",
} as const;
