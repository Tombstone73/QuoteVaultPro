# Titan Kernel Prompting Guide (for Copilot)

> This guide teaches Copilot to behave like a disciplined junior developer inside TitanOS.

---

## 1. Purpose

TitanOS is complex. Copilot works well only when treated like a junior dev with:

- clear context  
- clear files  
- clear rules  
- clear acceptance criteria  

This guide defines the **Kernel-style prompt pattern** used for every Copilot request.

---

## 2. Core Principles

1. **Be specific** – Always "implement X in file Y with behaviors Z."  
2. **Provide context** – Always include:  
   - tech stack  
   - file path(s)  
   - existing code  
   - goal  
   - constraints  

3. **Declare architecture rules** – Always remind Copilot:  
   - multi-tenant with `organizationId`  
   - React + TS + Vite + React Query + shadcn/ui  
   - Express + Drizzle + PostgreSQL + Zod  

4. **Pin the scope** – Tell Copilot which files it may edit and which it must not.  
5. **Define "done"** – Include acceptance criteria to prevent partial work.

---

## 3. Standard Prompt Template (GitHub-Safe)

Use this shape for *every* Copilot change:

<pre><code>
You are helping edit a multi-tenant React + TypeScript + Node + Postgres app called TitanOS.

Tech stack:
  - Frontend: React + TypeScript + Vite + React Query + shadcn/ui + Tailwind
  - Backend: Node + Express + Drizzle ORM + PostgreSQL + Zod validation
  - Multi-tenancy: every core table and API is scoped by organizationId.

We are editing the following file:
  [FILE PATH] (example: client/src/pages/orders.tsx)

CURRENT CODE (paste below):
  [PASTE CURRENT FILE OR RELEVANT PORTION HERE]

GOAL:
  [Describe the feature/change in clear business terms.]

REQUIREMENTS:
  - [Behavior 1]
  - [Behavior 2]
  - [UI/UX expectations]
  - [API interactions]

DATA MODEL / API ASSUMPTIONS:
  - [Shape of fields: id, customerId, status, etc.]
  - [Routes to use: e.g., GET /api/orders or PATCH /api/orders/:id/cancel]

CONSTRAINTS:
  - Do NOT change existing API contracts.
  - Do NOT modify unrelated files.
  - Do NOT remove multi-tenancy filters.
  - Use existing hooks (e.g., useOrders, useUpdateOrder).
  - Use React Query for all data fetching.
  - Use shadcn/ui components and existing styling.
  - TypeScript must compile with zero errors.

ACCEPTANCE CRITERIA:
  - [Functional behavior]
  - [UI outcome]
  - [Error handling]
  - [No TypeScript or runtime errors]

Please update the code in the provided file to meet these requirements.
Respond with the FULL updated file.
</code></pre>

---

## 4. Frontend-Specific Tips

When editing React pages/components:

Include:
- File path(s)  
- The entire component when reasonable  

Specify:
- Which hooks to use (`useOrders`, `useQuotes`, `useInvoices`, etc.)  
- Which shadcn/ui components to use (`Button`, `Dialog`, `Table`, `Tooltip`)  
- Navigation expectations (`useNavigate`, `<Link />`)  

Acceptance examples:
- "All columns in the table are sortable."  
- "Buttons show tooltips on hover."  
- "Form validates and shows inline errors."  
- "No layout shift when toggling filters."

---

## 5. Backend-Specific Tips

When editing routes, services, or Drizzle schemas:

Include:
- File path for route and storage/service  
- Relevant Zod schemas  
- Relevant `shared/schema.ts` sections  

Specify:
- Request body  
- Response shape  
- Validation rules  
- Required multi-tenancy enforcement  

Backend constraints:
- Always validate with Zod.  
- Always filter by `organizationId`.  
- Always return `{ success: true, data }` or `{ error: string }`.  
- Never silence errors.

---

## 6. Full-Stack Change Pattern

If a feature touches both backend and frontend:

1. Define the API contract.  
2. Tell Copilot to update:  
   - Schema (if needed)  
   - Routes  
   - Storage/services  
   - Hooks  
   - UI  

If needed, break into steps:
1. Backend  
2. Hooks/types  
3. UI  

---

## 7. "Do NOT Let Copilot Do This"

- Never let it:
  - invent new folders  
  - rename entities  
  - remove `organizationId`  
  - loosen validation  
  - rewrite unrelated modules  
  - refactor entire files  

If Copilot drifts:
- Paste its output to ChatGPT for a corrective prompt.

---
