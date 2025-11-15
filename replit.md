# Pricing Calculator Web Application

## Overview

A professional web application designed to generate pricing quotes for print products (e.g., business cards, postcards, flyers, banners). The system supports multi-user authentication, tracks quote history, and provides administrative capabilities for product management and analytics. Its core purpose is to empower sales teams with a tool for quick and accurate quote generation based on product dimensions, quantities, and customizable add-on options, while centralizing data and offering administrative oversight. The project aims to provide a robust, scalable, and user-friendly platform for managing the entire quoting process.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is built with React 18 and TypeScript, using Vite for bundling. It leverages Shadcn/ui (New York style) on Radix UI primitives and Tailwind CSS for a Material Design-inspired interface. State management is handled by TanStack Query for server state and React Hook Form with Zod for form validation. Wouter provides lightweight client-side routing. The design system uses Inter and JetBrains Mono fonts, an 8-point grid, and a mobile-first responsive approach with a light mode theme.

### Backend

The backend uses Node.js with Express.js, exposing a RESTful JSON API. PostgreSQL (via Neon serverless) is the primary database, accessed through Drizzle ORM for type-safe operations. Authentication is OIDC-based via Replit, utilizing Passport.js and `connect-pg-simple` for session management with role-based access control.

### Key Architectural Decisions

-   **Monorepo Structure**: Organizes `client/`, `server/`, and `shared/` directories to facilitate code and type sharing.
-   **Type Safety**: Achieved through shared TypeScript schemas and Zod for runtime validation.
-   **Session Storage**: PostgreSQL-backed sessions ensure scalability and persistence.
-   **Path Aliases**: Enhances import clarity within the codebase.
-   **Data Models**: Core entities include Users, Products, Product Options, Quotes, Pricing Rules, and Sessions. Relationships link users to quotes, products to quotes, and products to their configurable options, including a 2-layer hierarchy for nested options.
-   **Pricing Calculation Engine**: Utilizes formula-based pricing stored in product records, evaluated at runtime with `mathjs`. Supports dynamic product options (Toggle, Number, Select types) with configurable setup costs, JavaScript pricing formulas, and default states. Admin users can configure products, options, and formulas without code deployments.
-   **Multi-Line Quote System**: Quotes support multiple line items, allowing for complex quotes involving various products. This includes a parent-child model for quotes and line items, enabling detailed tracking and display.
-   **Quote Editing System**: Provides full CRUD capabilities for editing saved quotes, including customer information, line items, and price adjustments (tax, margin, discount).
-   **Default Dropdown Selection**: Admins can specify default selections for dropdown product options, improving user experience by pre-populating common choices.
-   **Show Store Link Toggle**: Granular control over the visibility of external store links for each product in the calculator interface.

### Application Features

-   **User Capabilities**: Generate quotes with dynamic options, view/filter quote history, save/retrieve quotes, and email quotes.
-   **Admin Capabilities**: System-wide quote management, CRUD operations for products and product options (including defining option types, costs, formulas, and hierarchies), pricing formula management, and analytics with CSV export.
-   **UI Components**: Dynamic calculator interface, searchable/filterable quote history, admin dashboard with metrics, and comprehensive admin settings for product and option management with tree views and inline editing.

## External Dependencies

### Third-Party Services

-   **Authentication**: Replit OIDC (OpenID Connect).
-   **Database**: Neon PostgreSQL serverless database.

### Key NPM Packages

-   **Frontend**: `@tanstack/react-query`, `wouter`, `react-hook-form`, `zod`, `@radix-ui/*`, `tailwindcss`, `date-fns`.
-   **Backend**: `express`, `drizzle-orm`, `@neondatabase/serverless`, `openid-client`, `passport`, `express-session`, `connect-pg-simple`, `mathjs`.
-   **Shared/Build Tools**: `typescript`, `vite`, `esbuild`, `tsx`.

### Environment Configuration

-   Required environment variables: `DATABASE_URL`, `SESSION_SECRET`, `REPL_ID`, `ISSUER_URL`, `NODE_ENV`.

### Integration Points

-   **Email**: Pending SMTP integration for quote emails.
-   **CSV Export**: Server-side generation of quote data.
-   **Product Store Links**: Products can link to external online store URLs with toggle control.