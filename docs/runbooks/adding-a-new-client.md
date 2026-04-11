# Runbook: Adding a New Client

## Prerequisites

- User must have `can_create` permission on the `MASTERS` module
- Valid session token (logged in)

## Steps

### 1. Navigate to Client Master

Go to the Masters page (`?page=masters`) in the web app.

### 2. Fill Client Details

| Field | Required | Notes |
|-------|----------|-------|
| Client Name | Yes | Company or individual name |
| State | Recommended | Used for GST intra/inter-state determination |
| GSTIN | Recommended | 15-character GST number |
| PAN | Auto-derived | Extracted from GSTIN positions 3-12 if GSTIN provided |
| Credit Days | No | Default payment terms |
| Category | No | Client classification |
| Payment Terms | No | Text description of payment terms |

**Client Code** is auto-generated (e.g., C00001, C00002) by `_clientNextCode_()`. You cannot choose it manually.

### 3. Add Bill-To and Ship-To Addresses

At least one BILL_TO and one SHIP_TO address row is required.

For each address:

| Field | Required | Notes |
|-------|----------|-------|
| Party Name | Yes | Name at this address |
| Address Type | Yes | BILL_TO or SHIP_TO |
| Address Line 1 | Yes | Street address |
| Address Line 2 | No | Additional address |
| City | No | City |
| State | Yes | State (for GST) |
| Pincode | No | PIN code |
| GSTIN | No | GST at this location |
| Contact Person | No | Contact name |
| Contact Phone | No | Contact number |
| Is Default | No | Set one as default per type |
| Label | No | Short label (e.g., "Head Office", "Factory") |

**Rules:**
- Maximum one default BILL_TO address
- Maximum one default SHIP_TO address
- If no default specified, the first address of each type becomes default

### 4. Save

Click Save. The system will:
1. Generate client code if new
2. Validate all required fields
3. Insert/update `clients` record
4. Delete and re-insert all `client_parties` records

### 5. Verify

The client should now appear in:
- Client dropdown on Sales Order form
- Client master list on Masters page
- `mastersGetBootstrap()` response

## Editing an Existing Client

Same form, but:
- Client code is read-only
- Existing parties are loaded for editing
- `can_edit` permission required instead of `can_create`

## Deactivating a Client

Use `mastersToggleClientStatus(clientId, false, token)`. The client will:
- Not appear in active client dropdowns
- Still be visible in historical records (SOs, invoices)

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Client name is required" | Empty client name | Fill in the name |
| "At least one BILL_TO row is required" | No billing address | Add a BILL_TO address row |
| "State is required in row N" | Missing state on an address | Fill in the state |
| "Only one default BILL_TO row is allowed" | Multiple defaults | Uncheck extra defaults |
| Client not showing in SO dropdown | Client is inactive | Activate the client |

## Backend Details

- **Create function**: `mastersSaveClient(payload, token)`
- **Table**: `clients` + `client_parties`
- **Permission**: `MASTERS` module, `can_create` or `can_edit`
- **Trigger**: `trg_client_parties_updated_at` auto-sets `updated_at`
