# Clients Module

## Overview

The Clients module manages customer master data including multi-party addresses for billing and shipping. Each client can have multiple bill-to and ship-to addresses (via `client_parties`), with one default per type. Clients are referenced throughout the system by `client_code`.

## Tables

| Table | Purpose |
|-------|---------|
| `clients` | Customer master (code, name, state, GSTIN, PAN, credit days) |
| `client_parties` | Multiple bill-to/ship-to addresses per client |
| `client_master_import_staging` | Bulk import staging table |

## Client Fields

| Field | Description |
|-------|-------------|
| `client_code` | Unique code (e.g., C00001) - auto-generated |
| `client_name` | Company/individual name |
| `state` | Client's state (for GST inter/intra-state determination) |
| `gstin` | GST identification number |
| `pan_no` | PAN (auto-derived from GSTIN positions 3-12) |
| `credit_days` | Credit terms in days |
| `category` | Client category |
| `payment_terms` | Payment terms text |
| `active` | Boolean active flag |
| `bill_to_*` / `ship_to_*` | Legacy address fields (kept for backward compatibility) |

## Client Parties (Multi-Address)

Each client can have multiple bill-to and ship-to addresses:

| Field | Description |
|-------|-------------|
| `address_type` | `BILL_TO` or `SHIP_TO` (check constraint) |
| `party_name` | Name of the party at this address |
| `label` | Short label for the address |
| `address_line1` / `address_line2` | Address lines |
| `city` / `state` / `pincode` | Location |
| `gstin` / `pan_no` | Tax identifiers for this party |
| `payment_terms` | Party-specific payment terms |
| `contact_person` / `contact_phone` | Contact details |
| `is_default` | Whether this is the default address for its type |

### Constraints

- One default BILL_TO per client (partial unique index: `uq_client_parties_one_default_bill_to`)
- One default SHIP_TO per client (partial unique index: `uq_client_parties_one_default_ship_to`)
- At least one BILL_TO and one SHIP_TO required (validated in Apps Script)

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `mastersGetBootstrap(token)` | Load all clients with their parties |
| `mastersSaveClient(payload, token)` | Create or update a client with parties |
| `mastersToggleClientStatus(clientId, active, token)` | Activate/deactivate a client |
| `getClients()` | Get active clients for dropdowns |
| `_clientNextCode_()` | Generate next client code (C00001, C00002, ...) |

## Client Save Flow

1. Normalize payload (`_clientNormalizePayload_`)
2. Auto-derive PAN from GSTIN if available
3. Validate party rows (`_clientNormalizePartyPayloadRows_`):
   - At least one BILL_TO and one SHIP_TO required
   - Each party must have party_name, address_line1, state
   - Maximum one default per type
   - Auto-set first party as default if none specified
4. Upsert client record
5. Delete existing parties and re-insert (replace strategy)

## Backward Compatibility

The `_clientSelectRows_()` function has a multi-level fallback for column compatibility:
1. Try full column list (including bill_to_*, ship_to_*, pan_no, payment_terms)
2. If columns missing, fall back to legacy columns (address, city, pincode)
3. If those missing too, fall back to basic columns only

This handles schema migrations where new columns may not yet exist.

## Integration

- **Sales Orders**: `client_code` is FK on `sales_orders`
- **Invoicing**: Bill-to/ship-to resolved from `client_parties` during invoice creation
- **Masters Page**: Client management UI (page: `masters`, module: MASTERS)
