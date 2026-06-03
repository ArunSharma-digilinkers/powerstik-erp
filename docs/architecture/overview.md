# System Architecture Overview

## Three-Tier Architecture

Powerstik ERP uses a serverless three-tier architecture with no traditional application server.

```
+---------------------+       +---------------------+       +---------------------+
|   Google Sheets     |       |  Google Apps Script  |       |      Supabase       |
|   (Presentation)    | <---> |   (Integration)      | <---> |   (Data Backend)    |
|                     |       |                      |       |                     |
|  - HTML pages via   |       |  - Code.gs (~34.2K   |       |  - PostgreSQL DB    |
|    doGet()          |       |    lines)             |       |  - PostgREST API    |
|  - Module-specific  |       |  - REST calls to     |       |  - Triggers &       |
|    UI forms         |       |    Supabase           |       |    functions        |
|  - Client-side JS   |       |  - Auth management   |       |  - Views & indexes  |
+---------------------+       +---------------------+       +---------------------+
```

**Layer 1 -- Presentation (Google Sheets):** The web app is served via `doGet(e)`. Each ERP module is an HTML page rendered by Apps Script. Users interact through browser-based forms and grids, not native Sheets cells.

**Layer 2 -- Integration (Google Apps Script):** A single `Code.gs` file contains all server-side logic. It handles authentication, authorization, data fetching, business logic orchestration, and Supabase API calls. Configuration is stored in Script Properties.

**Layer 3 -- Data Backend (Supabase):** PostgreSQL hosts all tables, views, triggers, and functions. Supabase's PostgREST layer exposes a REST API. Business rules are enforced at the database level through triggers and constraints.

---

## Page and Module Routing

The `doGet(e)` function serves pages based on the `?page=` query parameter and validates access.

### PAGE_MODULE_MAP

Routes map URL page names to internal module codes used for RBAC:

| Page Parameter     | Module Code          |
|--------------------|----------------------|
| `order`            | `SALES_ORDER_ENTRY`  |
| `artwork`          | `ARTWORK`            |
| `wow` / `flexowo`  | `WOW`                |
| `production`       | `PRODUCTION`         |
| `billing`          | `BILLING`            |
| `inventory`        | `INVENTORY`          |

### Request Flow

```
Browser request
  -> doGet(e)
    -> Extract ?page= and ?token= parameters
    -> Validate session token (getSessionUser)
    -> Look up module_code from PAGE_MODULE_MAP
    -> Check user permissions for that module (checkPermission)
    -> If authorized: serve the HTML page
    -> If unauthorized: serve an access-denied page
```

---

## Authentication

Authentication uses custom session tokens stored in a Supabase table. There is no OAuth or Supabase Auth integration.

### Session Table

```sql
create table public.erp_sessions (
  token   text not null,       -- Primary key, the session token
  user_id text null,
  payload jsonb null,          -- Cached user/role data
  created_at timestamp without time zone null default now()
);
```

### Auth Flow

```
1. User submits credentials
2. loginAndGetToken():
   a. Verify user_id + password_hash against 'users' table
   b. Generate a unique session token
   c. Insert into erp_sessions with user payload
   d. Return token to client
3. On subsequent requests:
   a. getSessionUser(token) reads erp_sessions
   b. Returns user_id, role, and permissions from payload
   c. checkPermission(user, module_code, action) gates access
```

### Users Table

```sql
create table public.users (
  id            uuid not null default gen_random_uuid(),
  user_id       text not null,        -- Login username (unique)
  password_hash text not null,
  display_name  text null,
  role          text null,            -- Legacy role field
  active        boolean default true,
  role_id       uuid null             -- FK to roles table (RBAC)
);
```

---

## Role-Based Access Control (RBAC)

Permissions are defined per role per module. Each user is assigned one role via `users.role_id`.

### Schema

```sql
create table public.roles (
  id        uuid not null default gen_random_uuid(),
  role_code text not null,   -- e.g. 'ADMIN', 'SALES', 'PRODUCTION'
  role_name text not null,
  active    boolean default true
);

create table public.role_permissions (
  id                    uuid not null default gen_random_uuid(),
  role_id               uuid,          -- FK to roles
  module_code           text not null,  -- e.g. 'SALES_ORDER_ENTRY', 'BILLING'
  can_view              boolean default false,
  can_create            boolean default false,
  can_edit              boolean default false,
  can_delete            boolean default false,
  can_approve_accounts  boolean default false,
  can_approve_business  boolean default false
);
```

### Permission Check Logic

```
checkPermission(user, module_code, action):
  1. Load role_permissions where role_id = user.role_id AND module_code = target
  2. Check the relevant boolean (can_view, can_create, can_edit, etc.)
  3. Return true/false
```

The `can_approve_accounts` and `can_approve_business` flags control who can approve SO lines at each stage, enforcing segregation of duties.

---

## Configuration

Global configuration is stored in Google Apps Script's Script Properties (key-value store, not in source control).

| Property               | Purpose                                        |
|------------------------|------------------------------------------------|
| `SUPABASE_URL`         | Base URL for the Supabase PostgREST API        |
| `SUPABASE_SERVICE_KEY` | Service-role API key (full DB access)           |
| `SPREADSHEET_ID`       | ID of the primary Google Sheets workbook        |
| `MASTER_DB_ID`         | ID of the master data spreadsheet (if separate) |
| `APP_SECRET_KEY`       | Secret used for token generation/signing        |

---

## Supabase API Layer

All database interaction goes through a set of generic CRUD wrapper functions that call the Supabase PostgREST API.

### Core Functions

| Function                          | HTTP Method | Purpose                                    |
|-----------------------------------|-------------|--------------------------------------------|
| `supabaseSelect(table, query)`    | GET         | Read rows with filters, ordering, limits   |
| `supabaseInsert(table, data)`     | POST        | Insert one or more rows                    |
| `supabaseUpdate(table, data, match)` | PATCH    | Update rows matching filter criteria       |
| `supabaseDelete(table, match)`    | DELETE      | Delete rows matching filter criteria       |
| `supabaseUpsert(table, data)`     | POST        | Insert or update (on conflict)             |
| `supabaseRpc(fn, params)`         | POST        | Call a PostgreSQL function via RPC          |

### Retry Logic

The internal `_supabaseFetch_()` function wraps all HTTP calls with fault tolerance:

- **3 retry attempts** with exponential backoff
- Retries on transient errors: "Address unavailable", "Timed out"
- Non-transient errors (4xx, constraint violations) fail immediately

### Batch Helpers

- `_supabaseSelectByKeyInBatches_(table, column, values, batchSize)` -- Splits large `IN` filter arrays into chunks to avoid URL length limits and query planner issues. Each chunk is fetched separately and results are merged.

---

## Caching

Google Apps Script's `CacheService` provides an in-memory cache shared across script executions within the same deployment.

| Cache Key Pattern | TTL    | Contents                          |
|-------------------|--------|-----------------------------------|
| `WO_MASTERS`      | 600s   | Master data for work order forms  |
| Dataset keys      | 600s   | Query results with version stamps |

Cache entries are invalidated by version bumps: when underlying data changes, the version number increments, causing the next read to miss the stale cache entry and re-fetch from Supabase.
