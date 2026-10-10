---
name: create-spec
description: Create a rigorous specification document (spec.md) for a new feature or change based on codebase research. Use when the user asks to create a spec, run /create-spec, or specify a feature across any project.
---

# /create-spec — Universal Feature Specification Generator

Guides the agent in researching any codebase and authoring an authoritative specification document (`spec.md` or `.agents/specs/<feature-slug>.md`).

---

## Core Rules

1. **What, Not How**: Specify behaviors, contracts, invariants, and constraints. Do not write code snippets or developer implementation steps.
2. **Read-Only**: Do not modify any source code files during this workflow.
3. **Concrete Grounding**: Research the active project first. Ground the spec in actual paths, existing tables/models, endpoints, components, and package manifests of the target repository.
4. **Mandatory Exact Headings**: The document must contain exactly the 11 sections below in the given order.
5. **No Empty Sections**: Write `None` for non-applicable sections. Never omit any section.
6. **No Implementation Plan**: Do not generate task checklists, phases, or coding sequences.

---

## Workflow

### 1. Parse Feature Arguments
- Extract the feature name and requirements from the prompt.
- If scope is missing or ambiguous, ask the user for clarification before proceeding.
- Output path: `.agents/specs/<feature-slug>.md` (or `spec.md` if explicitly requested or preferred in the current project).

### 2. Research the Codebase
Before writing the spec, thoroughly inspect the active project:
- **Architecture & Guidelines**: Project instructions (`AGENTS.md`, `CLAUDE.md`, `README.md`, or architecture docs).
- **Data Layer**: Existing schema definitions, ORM models, migrations, or database configs.
- **API & Controllers**: Existing routes, controllers, middleware, and request/response conventions.
- **Frontend / Client**: Existing UI components, pages, templates, and state management (if applicable).
- **Dependencies**: Active dependencies in package/build manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.).

### 3. Create the Specification Document
Generate the specification with **exactly** these 11 headings in this order:

```markdown
# <Spec Title>

## Overview
High-level description of what the feature is, the problem it solves, and its expected behavior.

## Depends On
Prerequisites, systems, or preceding features required for this to work. If none, write `None`.

## Routes
All new, modified, or removed endpoints (HTTP method, path, params, request body, response schema, error codes). If none, write `None`.

## Database Changes
New or altered tables, columns, indexes, schemas, foreign keys, or cache keys and TTLs. If none, write `None`.

## Templates
UI screens, views, components, modal layouts, or email/notification templates. If none, write `None`.

## Files to Change
Existing repository files that must be updated. If none, write `None`.

## Files to Create
New repository files to create. If none, write `None`.

## New Dependencies
New external packages, libraries, or tools required with reason. If none, write `None`.

## Rules of Implementation
Domain logic, validation rules, invariants, data constraints, security, and edge-case behaviors (WHAT the system must enforce, not HOW to code it).

## Definition of Done(acceptance criteria)
Testable, verifiable criteria and scenarios required to consider the feature complete.
```

### 4. Validate and Save
Verify before writing the file:
- All 11 section headings exist with exact names and order.
- Non-applicable sections contain `None`.
- Document contains no code implementations and no phased task plans.
- Referenced file paths, schemas, and routes match actual project assets.
- Save to `.agents/specs/<feature-slug>.md` (or requested path) using `write_to_file`.

### 5. Report to User
- Provide the saved file path as a markdown link (`[spec.md](file:///path/to/spec.md)`).
- Give a concise 3–5 bullet summary of the overview, affected files, and acceptance criteria.
