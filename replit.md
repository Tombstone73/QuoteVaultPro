# Pricing Calculator Web Application

## Overview

A professional web application designed to generate pricing quotes for print products (e.g., business cards, postcards, flyers, banners). The system supports multi-user authentication, tracks quote history, and provides administrative capabilities for product management and analytics. Its core purpose is to empower sales teams with a tool for quick and accurate quote generation based on product dimensions, quantities, and customizable add-on options, while centralizing data and offering administrative oversight.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is built with React 18 and TypeScript, using Vite for bundling. It leverages Shadcn/ui (New York style) on Radix UI primitives and Tailwind CSS for a Material Design-inspired interface. State management is handled by TanStack Query for server state and React Hook Form with Zod for form validation. Wouter provides lightweight client-side routing. The design system uses Inter and JetBrains Mono fonts, an 8-point grid, and a mobile-first responsive approach with a light mode theme.

### Backend

The backend uses Node.js with Express.js, exposing a RESTful JSON API. PostgreSQL (via Neon serverless) is the primary database, accessed through Drizzle ORM for type-safe operations. Authentication is OIDC-based via Replit, utilizing Passport.js and `connect-pg-simple` for session management with role-based access control.

**Key Architectural Decisions**:
- **Monorepo Structure**: Organizes `client/`, `server/`, and `shared/` directories to facilitate code and type sharing.
- **Type Safety**: Achieved through shared TypeScript schemas and Zod for runtime validation.
- **Session Storage**: PostgreSQL-backed sessions ensure scalability and persistence.
- **Path Aliases**: Enhances import clarity within the codebase.

### Data Models

Core entities include Users, Products, Product Options, Quotes, Pricing Rules, and Sessions. Relationships link users to quotes, products to quotes, and products to their configurable options, including a 2-layer hierarchy for nested options.

**Pricing Calculation Engine**:
- Utilizes formula-based pricing stored in product records, evaluated at runtime with `mathjs`.
- Supports dynamic product options (Toggle, Number, Select types) with configurable setup costs, JavaScript pricing formulas, and default states.
- Admin users can configure products, options, and formulas without code deployments.

### Application Features

**User Capabilities**:
- Generate quotes by selecting products, entering dimensions/quantities, and configuring options.
- View and filter quote history, including options, and save/retrieve quotes.
- Email quotes to customers.

**Admin Capabilities**:
- System-wide view and advanced filtering of all quotes.
- CRUD operations for product and product options management, including defining option types, costs, formulas, and hierarchies.
- Manage pricing formulas and access analytics with CSV export capabilities.

**UI Components**:
- Calculator interface with dynamic options and price breakdown.
- Searchable/filterable quote history table.
- Admin dashboard with metrics and a system-wide quote table.
- Admin settings interface for product, option, and formula management, featuring a tree view for options and inline editing.

## External Dependencies

### Third-Party Services

- **Authentication**: Replit OIDC (OpenID Connect), with a configurable issuer URL.
- **Database**: Neon PostgreSQL serverless database, requiring `DATABASE_URL` environment variable.

### Key NPM Packages

**Frontend**:
- `@tanstack/react-query`: Server state management.
- `wouter`: Routing.
- `react-hook-form`: Form management.
- `zod`: Schema validation.
- `@radix-ui/*`: Headless UI components.
- `tailwindcss`: CSS framework.
- `date-fns`: Date utilities.

**Backend**:
- `express`: Web server.
- `drizzle-orm`: ORM.
- `@neondatabase/serverless`: Neon client.
- `openid-client`: OIDC client.
- `passport`: Authentication middleware.
- `express-session`: Session management.
- `connect-pg-simple`: PostgreSQL session store.
- `mathjs`: Mathematical expression evaluation.

**Shared/Build Tools**:
- `typescript`, `vite`, `esbuild`, `tsx`.

### Environment Configuration

Required environment variables: `DATABASE_URL`, `SESSION_SECRET`, `REPL_ID`, `ISSUER_URL`, `NODE_ENV`.

### Integration Points

- **Email**: Pending SMTP integration for quote emails.
- **CSV Export**: Server-side generation of quote data, including detailed option information.
- **Product Store Links**: Products can link to external online store URLs with toggle control.

## Recent Changes

### Show Store Link Toggle (November 15, 2025)

Added granular control over external store link visibility in the calculator:

**Feature:**
- New `showStoreLink` boolean field added to products table
- Admin toggle in both Add Product and Edit Product forms
- Controls whether "View in Store" button appears in calculator
- Defaults to `true` (enabled) to preserve pre-feature behavior

**Implementation Details:**
- **Schema**: `showStoreLink` boolean column with default value `true`
- **Admin UI**: Switch component placed between Store URL field and Active toggle
- **Calculator Logic**: "View in Store" button renders only when both `storeUrl` exists AND `showStoreLink` is `true`
- **Database Migration**: Column added with default `true`, existing products backfilled

**UX Improvements:**
- Admin can disable store links for specific products even if URL exists
- Opt-out model: links show by default when URL is entered (preserving legacy behavior)
- Explicit control over which products expose external store links
- Changes persist immediately to database

**Test Coverage:**
- Toggle default state verified (ON by default)
- Store link visibility controlled by toggle
- Both conditions (URL + toggle) required for button display
- Existing products retain store link functionality (backfilled)
- Admin can enable/disable toggle per product