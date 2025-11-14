# Pricing Calculator Web Application

## Overview

A professional pricing calculator web application for generating quotes on print products (business cards, postcards, flyers, brochures, banners, etc.). The system supports multi-user authentication, quote history tracking, and admin capabilities for managing products and viewing system-wide analytics.

**Core Purpose**: Enable sales teams to quickly generate accurate pricing quotes for custom print products based on dimensions, quantities, and add-on options, while maintaining a centralized quote history and administrative oversight.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript using Vite as the build tool

**UI Component System**: 
- Shadcn/ui component library (New York style variant) built on Radix UI primitives
- Tailwind CSS for styling with custom design tokens
- Material Design-inspired approach prioritizing clarity and data density for B2B productivity

**State Management**:
- TanStack Query (React Query) for server state management and data fetching
- React Hook Form with Zod validation for form state
- Local component state with React hooks

**Routing**: Wouter for lightweight client-side routing

**Design System**:
- Typography: Inter font for UI elements, JetBrains Mono for pricing/numerical data
- Spacing: Tailwind's 8-point grid system (units of 2, 4, 6, 8)
- Responsive: Mobile-first with breakpoints for desktop layouts
- Theme: Light mode with customizable HSL color system via CSS variables

### Backend Architecture

**Runtime**: Node.js with Express.js server

**API Pattern**: RESTful JSON API with session-based authentication

**Database Access**: 
- Drizzle ORM for type-safe database operations
- PostgreSQL as the primary database (via Neon serverless)
- Schema-first approach with TypeScript types derived from Drizzle schemas

**Authentication Strategy**:
- Replit OIDC-based authentication using OpenID Connect
- Session management with connect-pg-simple for PostgreSQL-backed sessions
- Passport.js for authentication middleware
- Role-based access control (standard users vs. admin users)

**Key Architectural Decisions**:
1. **Monorepo Structure**: Single repository with `client/`, `server/`, and `shared/` directories for code organization and type sharing
2. **Type Safety**: Shared TypeScript schemas between frontend and backend using Zod for runtime validation
3. **Session Storage**: PostgreSQL-backed sessions for scalability and persistence across server restarts
4. **Path Aliases**: TypeScript path mapping (`@/`, `@shared/`, `@assets/`) for cleaner imports

### Data Models

**Core Entities**:

1. **Users**: Authenticated users with profile information and admin flags
2. **Products**: Print product definitions with pricing formulas and descriptions
3. **Quotes**: Generated price quotes with customer info, dimensions, quantities, and calculated prices
4. **Pricing Rules**: Configurable pricing formulas and discount tiers (admin-managed)
5. **Sessions**: Server-side session storage for authentication state

**Key Relationships**:
- Users → Quotes (one-to-many): Each user can generate multiple quotes
- Products → Quotes (one-to-many): Each product can appear in multiple quotes
- Quotes include denormalized product/user data for historical accuracy

**Pricing Calculation Engine**:
- Formula-based pricing stored as strings in product records
- Runtime evaluation of formulas with dimension and quantity inputs
- Support for add-on pricing modifiers
- Admin-configurable formulas without code deployment

### Application Features

**User Capabilities**:
- Calculate quotes: Select product, enter dimensions/quantity, apply add-ons
- View quote history: Filter by customer, product, date range, price range
- Save and retrieve quotes for repeat customers
- Email quotes to customers

**Admin Capabilities**:
- View all quotes across all users system-wide
- Advanced filtering: by user/salesperson, customer, product, quantity ranges
- Product management: CRUD operations on product catalog
- Formula management: Edit pricing formulas and discount rules
- Analytics: User activity tracking and CSV export for production planning

**UI Components**:
- Calculator interface: Two-column layout (product selection | price display)
- Quote history table: Searchable/filterable data grid
- Admin dashboard: Multi-column metrics and system-wide quote table
- Admin settings: Tabbed interface for product and formula management

## External Dependencies

### Third-Party Services

**Authentication**: 
- Replit OIDC (OpenID Connect) for user authentication
- Issuer URL: `https://replit.com/oidc` (configurable via environment)

**Database**:
- Neon PostgreSQL serverless database
- Connection via WebSocket for serverless compatibility
- Required environment variable: `DATABASE_URL`

### Key NPM Packages

**Frontend**:
- `@tanstack/react-query`: Server state management and caching
- `wouter`: Lightweight routing
- `react-hook-form`: Form state management
- `zod`: Runtime schema validation
- `@radix-ui/*`: Headless UI component primitives
- `tailwindcss`: Utility-first CSS framework
- `date-fns`: Date manipulation and formatting

**Backend**:
- `express`: Web server framework
- `drizzle-orm`: Type-safe ORM
- `@neondatabase/serverless`: Neon PostgreSQL client
- `openid-client`: OpenID Connect client
- `passport`: Authentication middleware
- `express-session`: Session management
- `connect-pg-simple`: PostgreSQL session store

**Shared/Build Tools**:
- `typescript`: Type system
- `vite`: Frontend build tool and dev server
- `esbuild`: Backend bundler for production
- `tsx`: TypeScript execution for development

### Environment Configuration

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Secret for session encryption
- `REPL_ID`: Replit workspace identifier (for OIDC)
- `ISSUER_URL`: OIDC issuer URL (defaults to Replit)
- `NODE_ENV`: Environment mode (development/production)

### Integration Points

**Email**: Quote email functionality requires SMTP integration (implementation pending)

**CSV Export**: Server-side CSV generation for quote data export

**Product Store Links**: Each product can link to an external online store URL for direct ordering