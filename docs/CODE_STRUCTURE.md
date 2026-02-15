# Code Structure

## Monorepo Layout

```text
roaming-interconnect-dashboard/
  backend/      # Express + TypeScript API
  frontend/     # React + TypeScript UI
  render/       # Render deployment notes/assets
  docs/         # Project documentation
```

## Backend Structure

```text
backend/src/
  controllers/  # Request handlers
  routes/       # Route registration
  middleware/   # Auth, rate limiting, etc.
  services/     # Business workflows
  utils/        # Shared helper functions
  workers/      # Background runner entry points
  modules/      # Feature-level export surfaces
  types/        # Type augmentations/declarations
```

### Ingestion Module

`backend/src/modules/ingestion/index.ts` is the feature entrypoint for ingestion-related exports:

- source CRUD/test/scan handlers
- ingestion run helpers

Route files can import ingestion APIs from `../modules/ingestion` instead of reaching into controllers/services directly.

## Frontend Structure

```text
frontend/src/
  pages/
    DataSourcesPage.tsx
    data-sources/
      types.ts   # Page-level types
      utils.ts   # Page-level helpers
  components/    # Shared UI components
  utils/         # Shared frontend helpers
```

### Data Sources Page Split

`DataSourcesPage.tsx` now keeps UI logic only, while:

- `pages/data-sources/types.ts` stores source form/view model types.
- `pages/data-sources/utils.ts` stores request parsing and display helper functions.

This keeps the page component smaller and easier to maintain.
