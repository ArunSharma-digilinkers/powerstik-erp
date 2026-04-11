# Data Flow Patterns

This document describes the key data flow patterns in the Powerstik ERP system: how data moves between Google Sheets, Apps Script, and Supabase.

---

## Sales Order Creation

Creating a sales order is a multi-table transactional write.

### Flow

```
User fills order form in browser
  -> Client-side JS calls google.script.run.saveOrderWithKey(orderData, idempotencyKey)
    -> Apps Script: saveOrderWithKey()
      1. Check idempotency_keys table for duplicate submission
      2. supabaseInsert('sales_orders', headerData)   -> returns SO id
      3. supabaseInsert('sales_order_lines', linesData) -> bulk insert lines
      4. createArtworksFromSoLines(soId, lines)        -> auto-create artwork records
      5. supabaseInsert('idempotency_keys', { key, response })
      6. Return SO id + SO number to client
```

### Idempotency

The `idempotency_keys` table prevents duplicate order creation from double-clicks or network retries.

```sql
create table public.idempotency_keys (
  key        text not null,      -- Client-generated unique key per submission
  response   jsonb null,         -- Cached response from first execution
  created_at timestamp with time zone default now()
);
```

On each save attempt:
1. Check if key already exists in `idempotency_keys`
2. If found: return the cached `response` without re-inserting
3. If not found: proceed with the insert, then store the response

---

## Master Data Loading

Master data (clients, items, etc.) is loaded at page initialization and cached.

### Flow

```
Page loads
  -> getMasters()
    1. Check CacheService for cached masters
    2. If cache hit: return cached data
    3. If cache miss:
       a. supabaseSelect('clients', { active: true })
       b. supabaseSelect('items', { active: true })
       c. Merge with DEFAULT_MASTERS (hardcoded fallback values)
       d. Apply overrides (e.g., environment-specific config)
       e. Store in CacheService with 600s TTL
       f. Return merged master data
```

DEFAULT_MASTERS provides baseline lookup values (units, categories, GST rates, etc.) so the UI is functional even before the Supabase fetch completes or if certain master tables are empty.

---

## Sales Order Rollup Cache

The `sales_order_rollup_cache` table maintains a denormalized summary of each sales order, updated automatically by triggers.

### Purpose

Rather than computing line-level aggregates on every list-page load (line counts, approval statuses, WO status), the rollup cache pre-computes and stores them.

### Trigger Sources

Three tables feed the rollup cache:

| Source Table         | Trigger Name                                 | Events             |
|----------------------|----------------------------------------------|--------------------|
| `sales_orders`       | `trg_sales_order_rollup_from_sales_orders`   | INSERT, UPDATE, DELETE |
| `sales_order_lines`  | `trg_sales_order_rollup_from_lines`          | INSERT, UPDATE, DELETE |
| `work_order_jobs`    | `trg_sales_order_rollup_from_work_order_jobs`| INSERT, UPDATE, DELETE |

### Cached Fields

```sql
create table public.sales_order_rollup_cache (
  so_id             text not null,     -- PK
  so_number         text,
  line_count        integer default 0,
  total_qty         numeric default 0,
  latest_delivery   date,
  accounts_status   text default 'PENDING',
  business_status   text default 'PENDING',
  wo_status         text default 'PENDING',
  is_approval_hold  boolean default false,
  can_edit          boolean default true,
  can_hold          boolean default true,
  can_cancel        boolean default true,
  hold_target       text default 'HOLD',
  hold_label        text default 'Hold',
  updated_at        timestamp with time zone default now()
);
```

When the SO list page loads, it reads from `sales_order_rollup_cache` (or the `v_sales_orders_list_fast` view that joins it) instead of aggregating across `sales_order_lines` and `work_order_jobs` per request.

---

## Materialized Views for Inventory

Inventory stock calculations involve heavy joins and aggregations across `inv_ledger` and `inv_lots`. Two materialized views pre-compute these.

### inv_stock_mv

Computes current stock position per item per location:

```sql
-- Simplified structure
create materialized view public.inv_stock_mv as
  select
    i.id as item_id,
    i.item_code,
    i.item_name,
    i.category,
    lb.location,
    lb.qty,               -- Net qty (sum of qty_in - qty_out from inv_ledger)
    avg_rate,              -- Weighted average rate from lot or ledger data
    value,                 -- qty * avg_rate
    lb.last_movement_at
  from ledger_balance lb
  join inv_items i on i.id = lb.item_id
  left join lot_balance lotb on ...
  where lb.qty <> 0;
```

### inv_stock_analytics_mv

Extends `inv_stock_mv` with analytics: consumption rates, reorder points, and trend data for planning dashboards.

### Refresh Pattern

Materialized views are stale until refreshed. The Apps Script layer calls `refreshStockMV_()` which invokes:

```
supabaseRpc('refresh_inv_stock_mv')
```

This executes `REFRESH MATERIALIZED VIEW` on the PostgreSQL side. Refresh is triggered after inventory transactions (GRN, issues, adjustments) to keep stock data current.

---

## Caching Strategy

### CacheService (Apps Script Layer)

Google Apps Script's `CacheService` provides a shared key-value cache with automatic expiry.

```
                 +------------------+
  Apps Script -> | CacheService     |
                 | (600s TTL)       |
                 +--------+---------+
                          |
                   cache miss
                          |
                          v
                 +------------------+
                 | Supabase API     |
                 +------------------+
```

### Cache Keys

| Key               | Contents                              | Invalidation             |
|--------------------|---------------------------------------|--------------------------|
| `WO_MASTERS`       | Clients, items for WO creation forms  | TTL expiry (600s)        |
| Dataset keys       | Query results for list pages          | Version bump on mutation |

### Version-Based Invalidation

For dataset caching, the system uses a version stamp pattern:

1. Each cached dataset includes a version number
2. When data is mutated (insert, update, delete), the version number is incremented
3. On the next read, the cached version is compared with the current version
4. Mismatch causes a cache miss, triggering a fresh fetch from Supabase
5. The fresh data is stored with the new version number

This approach avoids serving stale data while still reducing redundant API calls on rapid successive page loads.

---

## Batch Fetch Pattern

When filtering by a list of IDs (e.g., loading SO lines for multiple SOs), the `IN` clause can become too large for a single HTTP request or for the query planner to handle efficiently.

### _supabaseSelectByKeyInBatches_

```
_supabaseSelectByKeyInBatches_(table, column, values, batchSize):
  1. Split 'values' array into chunks of 'batchSize'
  2. For each chunk:
     a. Build a Supabase filter: column=in.(val1,val2,...valN)
     b. supabaseSelect(table, filter)
  3. Concatenate all chunk results
  4. Return merged array
```

This pattern is used wherever the system needs to load related records for a variable-length list of parent IDs, such as:
- Loading all SO lines for a page of sales orders
- Loading artwork records for a set of SO lines
- Loading production entries for a set of routing steps
