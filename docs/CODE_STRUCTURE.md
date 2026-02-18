# Code Structure

## Monorepo Layout

```text
roaming-interconnect-dashboard/
  backend/      # Express + TypeScript API
  frontend/     # React + TypeScript SPA
  docs/         # Architecture and project notes
  render/       # Deployment-specific files
```

## Backend Layers

```text
backend/src/
  routes/       # API endpoint wiring + middleware chain
  controllers/  # HTTP handling (validation, authz, response shape)
  services/     # Domain logic and analytics computations
  utils/        # Shared helpers (authz utils, parsing, encryption)
  middleware/   # Auth, rate limits, request guards
  workers/      # Background task entry points
  modules/      # Feature export surfaces (ingestion module)
  types/        # Type augmentation/declarations
  constants/    # Static constants
  models/       # Lightweight model exports
```

### Key Roaming/Interconnect Flows

```text
Ingestion:
  routes/ingestionSourceRoutes.ts
    -> controllers/ingestionSourcesController.ts
    -> services/ingestionService.ts
    -> services/ingestionRunner.ts

Agent Upload:
  routes/agentIngestionRoutes.ts
    -> controllers/agentIngestionController.ts
    -> controllers/fileController.ts (ingestFilesFromDisk)

Operations Snapshot:
  routes/operationsRoutes.ts
    -> controllers/operationsController.ts
    -> services/operationsSnapshot.ts

Partner Scorecard:
  routes/partnerScorecardRoutes.ts
    -> controllers/partnerScorecardController.ts
    -> services/partnerScorecard.ts

Impact Summary:
  routes/impactRoutes.ts
    -> controllers/impactController.ts

Data Quality:
  routes/dataQualityRoutes.ts
    -> controllers/dataQualityController.ts
```

### Access Control Pattern

Shared authorization checks live in:

- `backend/src/utils/accessControl.ts`

Controllers should:

1. Validate request input.
2. Check project/file access via `requireProjectAccess` or `requireFileAccess`.
3. Call service logic.
4. Return response payload.

## Frontend Structure

```text
frontend/src/
  pages/        # Route-level pages (operations, quality, sources, etc.)
  components/   # Reusable UI pieces
  hooks/        # UI data/state hooks
  utils/        # API + formatting helpers
  types/        # Frontend view types
  theme/        # Theme provider and style system
  data/         # Static/reference UI data
```

## Recommended Convention

- Keep controllers thin; move calculations/query assembly to services.
- Keep cross-cutting logic in `utils/`.
- Keep route files limited to wiring, not business logic.
