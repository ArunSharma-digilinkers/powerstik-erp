# ADR-001: Google Sheets as Frontend

## Status

Accepted

## Context

The company needed an ERP system to manage order-to-invoice operations. The team evaluated several approaches:

1. Traditional web application (React/Vue + Node.js/Python backend)
2. Low-code platforms (Retool, Appsmith)
3. Google Sheets as the UI layer with a cloud database backend

Key constraints:
- Small team with limited frontend development capacity
- Users already familiar with Google Sheets
- Need for rapid iteration and deployment
- Budget constraints (no dedicated hosting infrastructure)
- Indian printing/packaging business with GST compliance requirements

## Decision

Use Google Sheets deployed as a web app via `doGet()` as the frontend, with Google Apps Script as the integration layer and Supabase (PostgreSQL) as the data backend.

## Rationale

1. **Zero deployment cost**: Google Workspace is already paid for; Supabase free tier covers initial needs
2. **Familiar interface**: Users work in a Sheets-like environment - minimal training needed
3. **Rapid prototyping**: HTML pages served by Apps Script can be iterated quickly without CI/CD pipelines
4. **Built-in auth infrastructure**: Google account management handles user identity; custom sessions add RBAC
5. **No server to maintain**: Apps Script runs serverlessly; Supabase is fully managed
6. **Print-friendly**: Invoice and WO printing can leverage HTML templates served by Apps Script

## Trade-offs

### Accepted limitations

- **Performance ceiling**: Apps Script has execution time limits (6 min for consumer, 30 min for Workspace). Batch operations must be chunked.
- **Single-threaded**: Apps Script processes requests sequentially per deployment. Under high concurrent load, responses queue.
- **No real-time updates**: No WebSocket support. Users must refresh to see changes from other users.
- **Code management**: All code in a single `Code.gs` file (~20,500 lines). No native module system, bundling, or dependency management.
- **Limited UI framework**: HTML pages served by Apps Script lack the component ecosystem of React/Vue.

### Mitigations

- Heavy use of database views and materialized views to push computation to PostgreSQL
- Caching via `CacheService` (600s TTL) to reduce Supabase calls
- Batch helpers (`_supabaseSelectByKeyInBatches_`) to work within URL length limits
- Retry logic in `_supabaseFetch_` for transient network errors

## Consequences

- All business logic lives in either Apps Script (Code.gs) or PostgreSQL (triggers/functions/views)
- No npm ecosystem - all code is vanilla JavaScript (ES6) with Google Apps Script APIs
- Deployment is via Apps Script editor or clasp CLI
- Testing is manual - no automated test framework
- Future migration to a web app would require rewriting the UI layer but could reuse the Supabase backend
