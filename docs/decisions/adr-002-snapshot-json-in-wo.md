# ADR-002: Snapshot JSON in Work Orders

## Status

Accepted

## Context

When a work order is created, it pulls data from sales orders, sales order lines, artwork, and client records. After WO creation, the source data can change (prices updated, quantities revised, artwork modified). Production planning and tracking needs stable reference data that doesn't shift under active work.

Two approaches were considered:

1. **Normalized references**: WO jobs store FK references to SO lines. Views join live data. Any change to SO lines is immediately reflected in production screens.
2. **Snapshot approach**: WO stores a complete JSON snapshot of all relevant data at creation time. Production uses snapshot data, not live references.

## Decision

Store a `snapshot_json` JSONB column on the `work_orders` table that captures the complete state of the order at WO creation time. This snapshot is the authoritative reference for production.

## Snapshot Structure

```json
{
  "jobs": [{
    "soNumber": "SL-2526/0001",
    "lineNo": 1,
    "qty": 1000,
    "ups": 4,
    "coreSheets": 250,
    "artworkNo": "ART-001",
    "client": "ABC Corp",
    "productName": "Product Label"
  }],
  "papers": [{
    "stock": "Art Paper",
    "gsm": 130,
    "deckle": 23,
    "cutSize": 36,
    "sheets": 280,
    "requiredQty": 280,
    "sheetsWithWaste": 310
  }],
  "routing": [{
    "department": "Printing",
    "machine": "Heidelberg SM74",
    "sequenceNo": 1
  }],
  "wastage": {
    "processSheets": 30,
    "wastagePercent": 10
  },
  "jobDetails": {
    "type": "Offset",
    "printStyle": "Front-Back"
  },
  "flexoDetails": {
    "totalRunningMeter": 5000,
    "baseRunningMeter": 4500,
    "teeth": 96
  },
  "modeOfTransport": "Road"
}
```

## Rationale

1. **Stability**: Production planning numbers (core sheets, running meters, wastage) are locked at WO creation. Changing an SO line qty after WO creation doesn't silently alter production targets.

2. **Audit trail**: The snapshot serves as a record of what was planned. If actual production differs from the snapshot, the variance is meaningful - it's not just data drift from subsequent edits.

3. **Performance**: Production views (especially the complex recursive CTEs in `v_production_stage_queue_fast`) extract planned quantities directly from JSON without joining multiple tables. This is faster for the production board which is a high-traffic screen.

4. **Offline reference**: The snapshot contains denormalized client name, product name, artwork details - everything needed to display or print a WO without additional queries.

## Trade-offs

### Accepted

- **Data duplication**: Client name, product details, etc. are stored redundantly in both normalized tables and snapshot JSON
- **Snapshot staleness**: If an SO line rate changes after WO creation, the snapshot has the old rate. This is intentional for production but means billing must always reference live SO data, not snapshot data.
- **JSON querying complexity**: Extracting data from JSONB requires `->>`/`->>` operators and sometimes `jsonb_array_elements()`, which is less readable than simple column references

### Mitigations

- Views abstract away JSON access patterns (e.g., `v_production_stage_queue_fast` handles snapshot extraction)
- Apps Script helper functions (`_getStage1PlannedQtyFromSnapshot_`, `_getProductionUpsFactorFromSnapshot_`) encapsulate JSON parsing
- Item merge function (`_itemMasterPatchSnapshotForMerge_`) updates snapshot JSON when items are merged, keeping product references current

## Consequences

- WO creation must assemble the complete snapshot at save time (`saveWorkOrder` builds the JSON)
- Deleting and recreating a WO is the mechanism for "updating" production targets (there's no in-place edit of snapshot)
- Production views depend on the snapshot structure - changes to the JSON schema require updating views
- The snapshot is the single source of truth for production quantities; `work_order_jobs` stores basic info but production planning uses the snapshot
