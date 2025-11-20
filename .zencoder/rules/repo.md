---
description: Repository Information Overview
alwaysApply: true
---

# Pricing Calculator Web Application Information

## Summary
A professional web application designed to generate pricing quotes for print products (e.g., business cards, postcards, flyers, banners). The system supports multi-user authentication, tracks quote history, and provides administrative capabilities for product management and analytics. Its core purpose is to empower sales teams with a tool for quick and accurate quote generation based on product dimensions, quantities, and customizable add-on options, while centralizing data and offering administrative oversight.

## Structure
- **client/**: Frontend React application built with TypeScript, using Vite for bundling, Shadcn/ui on Radix UI primitives, and Tailwind CSS for styling
- **server/**: Backend Node.js server using Express.js, exposing a RESTful JSON API with PostgreSQL database via Drizzle ORM
- **shared/**: Shared TypeScript schemas and types for type safety across client and server
- **attached_assets/**: Static assets including images and documentation files related to the application

## Language & Runtime
**Language**: TypeScript  
**Version**: Node.js 20.16.11  
**Build System**: Vite (client) + esbuild (server)  
**Package Manager**: npm  

## Dependencies
**Main Dependencies**:  
- React ^18.3.1  
- Express ^4.21.2  
- Drizzle ORM ^0.39.1  
- @neondatabase/serverless ^0.10.4  
- @radix-ui/react-* (multiple components)  
- @tanstack/react-query ^5.60.5  
- Zod ^3.24.2  
- Passport.js ^0.7.0  
- Google Cloud Storage ^7.17.3  

**Development Dependencies**:  
- @types/node 20.16.11  
- @types/express 4.17.21  
- @tailwindcss/vite ^4.1.3  
- TypeScript compiler (tsc)  

## Build & Installation
```bash
npm install
npm run build
npm run start
```

## Main Files & Resources
**Entry Points**:  
- Frontend: client/index.html  
- Backend: server/index.ts  
- Shared schemas: shared/schema.ts  

**Configuration Files**:  
- tsconfig.json: TypeScript configuration  
- vite.config.ts: Vite bundler configuration  
- drizzle.config.ts: Database ORM configuration  
- tailwind.config.ts: CSS framework configuration