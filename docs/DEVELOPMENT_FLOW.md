# TitanOS Development Flow

> How we go from "idea in Batman's head" → "prompt" → "Copilot change" → "stable feature".

---

## 1. Roles

- **Batman (Product Owner / Supervisor)**  
  Describes what the system should do, prioritizes features, approves behavior.

- **Alfred (ChatGPT / Senior Dev)**  
  Translates business needs into architecture-aware specs and Copilot prompts.

- **Copilot (Junior Dev)**  
  Applies code changes in the repo following the prompts.

---

## 2. Standard Workflow for a Feature

### Step 1 — Describe the feature (Batman)

In natural language, explain:

- What you want the user to be able to do.
- Which screen(s) or module(s) it affects.
- Any must-have behaviors / constraints.

### Step 2 — Alfred maps it to the architecture

Alfred will:

- Identify the module(s) and layer(s).
- Check dependencies (using `MODULE_DEPENDENCIES.md`).
- Decide which files must be touched:
  - Backend (routes, storage, schema)
  - Frontend (pages, components, hooks)
- Identify any data model changes.

### Step 3 — Gather context

Before using Copilot, you (Batman) will:

- Open the repo.
- Copy the current contents of the main file(s) to be edited.
- Note any related types/schemas if needed.

### Step 4 — Alfred generates a Kernel-style Copilot prompt

The prompt will:

- Specify tech stack.
- Name the files.
- Include current code.
- State the goal & requirements.
- Describe data shapes.
- List constraints.
- Define acceptance criteria.

You paste this directly into Copilot Chat.

### Step 5 — Copilot edits the code

- Let Copilot apply changes.
- If it over-edits or drifts:
  - Undo / discard unwanted changes.
  - Ask Alfred for a tighter or corrective prompt.

### Step 6 — Local test

- Run dev server(s).
- Validate:
  - UI behaves as expected.
  - API calls succeed.
  - No errors in console or terminal.

If anything breaks:

- Copy the error + current file(s).
- Ask Alfred to diagnose and generate a patch prompt.

### Step 7 — Commit & Push

- Commit with clear message: `feat: add cancel actions to orders page`, etc.
- Push to GitHub.
- Optionally open PR for future contributors.

---

## 3. Priority Rules

When choosing **what to build next**, follow this general order:

1. Fix anything that blocks core flows:
   - Creating orders from quotes
   - Moving jobs through production
   - Deducting inventory
   - Creating invoices from orders

2. Next, improve visibility:
   - Better dashboards and lists
   - Sorting/filtering
   - Status clarity

3. Then, reduce manual work:
   - Automation (email parsing, auto-fills, routing)

4. Finally, add polish:
   - Cosmetic UI tweaks
   - Optional settings
   - Advanced analytics

---

## 4. When to Pause and Update Architecture Docs

If a feature:

- Introduces a new cross-module dependency,
- Adds a new global concept (e.g., "production location", "machine profiles"),
- Or changes how a core lifecycle works (e.g., multiple invoices per order),

Then:

1. Update `ARCHITECTURE.md` with the new concept.
2. Update `MODULE_DEPENDENCIES.md`.
3. Only then proceed to Copilot changes.

This prevents drift.

---

## 5. Handling Broken / Confusing Copilot Output

If Copilot:

- Refactors too much.
- Breaks TypeScript.
- Ignores `organizationId`.
- Changes API contracts silently.

Then:

1. Stop and revert those changes.
2. Copy:
   - The bad diff or updated file.
   - The original Copilot prompt.
3. Ask Alfred:
   - "Here's what Copilot did. Fix this and give me a corrective prompt."

Alfred will:

- Diagnose what went wrong.
- Write a tighter prompt that constrains Copilot properly.
- Optionally provide a manual code patch instead.

---

## 6. Long-Term Flow

As TitanOS matures:

- Introduce PR templates with:
  - Module(s) affected
  - Breaking changes
  - Screenshots
- Add automated tests around critical flows:
  - Convert quote → order
  - Move order to production → inventory deduction
  - Receive PO → stock increase
  - Create invoice → apply payment → zero balance

These tests become guardrails against regressions while we keep using Copilot.

---
