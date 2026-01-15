# QuoteVaultPro (TitanOS)

A comprehensive, multi-tenant ERP/MIS/CRM system built specifically for the printing and graphics industry.

## 🚀 Quick Start

### Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### First Time Setup

1. Copy `.env.example` to `.env` and configure your environment variables
2. Ensure PostgreSQL database is running (Neon or local)
3. Run `npm install` to install dependencies
4. Run `npm run db:push` to sync database schema (development only)
	- To check what migrations are applied, run `npm run db:status`
	- For a more detailed migration/journal view, run `npm run db:migrate:verbose`
	  - Note: this repo may have manual catchup migrations causing journal drift; on a non-empty DB `db:migrate:verbose` skips migrate when drift is detected
	  - To force migrate anyway (controlled use), set `FORCE_DRIZZLE_MIGRATE=1`
	- To verify PBV2 DB schema (read-only), run `npm run db:pbv2:check`
5. Run `npm run dev` to start the development server

### PBV2 Dev Smoke

- PBV2 HTTP smoke (requires authenticated session cookie):
  - `npm run pbv2:http:smoke -- --productId <productId> --cookie "connect.sid=..."`

## 📋 How to Contribute

**New to the project?** Start here:

1. **[CONTRIBUTING.md](CONTRIBUTING.md)** - Learn how to merge your edits into the default branch
2. **[docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)** - Detailed git workflow and branching strategies
3. **[docs/DEVELOPMENT_FLOW.md](docs/DEVELOPMENT_FLOW.md)** - Development workflow and best practices

## 📚 Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[docs/README.md](docs/README.md)** - Documentation hub and overview
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and design principles
- **[docs/MODULE_DEPENDENCIES.md](docs/MODULE_DEPENDENCIES.md)** - Module dependency graph
- **[docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)** - Git operations and merge workflows

### Module Documentation

Module-specific documentation can be found in `/docs/modules/`:

- CRM & Customers
- Products & Pricing
- Quotes & Orders
- Jobs & Production
- Inventory Management
- Vendors & Purchase Orders
- Invoicing & Payments
- Fulfillment & Shipping
- Customer Portal

## 🏗️ Tech Stack

### Frontend
- React 18 with TypeScript
- Vite for build tooling
- React Router v7 for routing
- TanStack Query for data fetching
- shadcn/ui + Radix UI components
- Tailwind CSS for styling
- React Hook Form + Zod for forms and validation

### Backend
- Node.js with Express
- TypeScript
- PostgreSQL with Drizzle ORM
- Passport.js for authentication
- Google Cloud Storage for file uploads
- Nodemailer for email

### Key Features
- Multi-tenant architecture with organization isolation
- Role-based access control (Owner, Admin, Manager, Employee, Customer)
- Advanced pricing calculator with nesting algorithms
- Complete quote-to-order-to-job-to-invoice workflow
- Customer portal for external access
- QuickBooks integration
- Email automation

## 🔐 Security & Multi-Tenancy

Every data query must:
- Filter by `organizationId` from authenticated user context
- Use proper authentication middleware (`isAuthenticated`, `tenantContext`)
- Validate all input using Zod schemas
- Apply role-based access controls

## 🧪 Testing

```bash
# Type checking
npm run check

# PBV2 validator tests (in-memory)
npm test -- --runTestsByPath shared/pbv2/tests/

# Run tests (if configured)
npm test

# Build check
npm run build
```

## 📦 Project Structure

```
QuoteVaultPro/
├── client/              # Frontend React application
│   ├── src/
│   │   ├── pages/      # Page components
│   │   ├── components/ # Reusable UI components
│   │   ├── hooks/      # Custom React hooks
│   │   └── lib/        # Utilities and helpers
├── server/             # Backend Node.js/Express
│   ├── routes.ts       # API routes (monolithic)
│   ├── db.ts           # Database connection
│   ├── services/       # Business logic
│   └── workers/        # Background jobs
├── shared/             # Shared code (schemas, types)
│   └── schema.ts       # Drizzle schemas and Zod validators
└── docs/               # Documentation

```

## 🤝 Contributing Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes following the [TitanOS guidelines](.github/copilot-instructions.md)
3. Commit with clear messages: `git commit -m "feat: add feature"`
4. Push to GitHub: `git push origin feature/your-feature`
5. Create a Pull Request on GitHub
6. Wait for review and CI checks
7. Merge when approved

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed instructions.

## 📖 Additional Resources

- [Kernel Instructions](.github/copilot-instructions.md) - AI agent guidelines
- [Design Guidelines](design_guidelines.md) - UI/UX standards
- [Replit Docs](replit.md) - Replit-specific setup

## 🆘 Need Help?

- Check the `/docs` directory for detailed documentation
- Review existing Pull Requests for examples
- Look at the module documentation in `/docs/modules/`
- See [CONTRIBUTING.md](CONTRIBUTING.md) for common scenarios

## 📄 License

Proprietary - All rights reserved

---

**Built with ❤️ for the printing industry**
