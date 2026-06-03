# Web App Page Map

## Overview

The Powerstik ERP is deployed as a Google Apps Script web app via the `doGet(e)` function. Each module is a separate HTML page served based on the `?page=` URL parameter. Authentication is enforced on every page load.

## Page Routing

The `doGet(e)` function:
1. Reads `page` parameter from the URL
2. Validates the session token
3. Checks module-level permissions via `_canAccessPage_()`
4. Serves the corresponding HTML template
5. If unauthorized, renders `renderUnauthorizedPage()`

## Page-to-Module Map

The `PAGE_MODULE_MAP` constant defines the mapping from URL page keys to RBAC module codes:

| Page Key | Module Code | Description |
|----------|------------|-------------|
| `menu` | MENU | Main menu / dashboard landing |
| `order` | SALES_ORDER_ENTRY | Sales order creation and editing |
| `salesorderapproval` | SALES_ORDER_APPROVAL | Accounts and business approval of SO lines |
| `artwork` | ARTWORK | Artwork workbench |
| `masters` | MASTERS | Client and item master management |
| `plates` | PURCHASE | Plate and die procurement |
| `purchase` | PURCHASE | Purchase order management |
| `itemmaster` | ITEMMASTER | Item master with BOM management |
| `wow` | WOW | Offset / Digital work order creation |
| `flexowo` | WOW | Flexo work order creation |
| `inventory` | INVENTORY | Inventory management (including sheet conversion and rate corrections) |
| `packing` | PACKING | Packing operations |
| `dispatch` | DISPATCH | Dispatch operations |
| `production` | PRODUCTION | Production entry and tracking |
| `billing` | BILLING | Invoice / challan creation |
| `printinvoice` | BILLING | Invoice print view |
| `printchallan` | BILLING | Delivery challan print view |
| `planning` | PLANNING | Planning dashboard (uses `v_report_planning_lines_enriched`) |
| `reports` | REPORTS | Reports dashboard (WIP, machine load, profitability, registers) |
| `costing` | COSTING | Product costing |
| `checklist` | CHECKLIST | Daily / periodic task module (templates → instances → completion) |
| `masteradmin` | MASTERADMIN | Admin panel (users, roles, permissions) |

> `PAGE_MODULE_MAP` lives at roughly line 700 in `Code.gs`.

## Sheet Constants

The codebase references several Google Sheets by ID:

| Constant | Value | Purpose |
|----------|-------|---------|
| `SPREADSHEET_ID` | `1voKg25EsXIYWquE78E3MtNSCTLiNssM6-HaWi1O_ngk` | Main ERP workbook |
| `EXTERNAL_SO_DB_ID` | Same as SPREADSHEET_ID | External SO database (same workbook) |
| `MASTER_DB_ID` | `1kJpXEhwjhf74PutuvkoVF5WlMdl0v3P7orTbJ6SenHs` | Master data workbook |

## Sheet Tab Names

The `SH` constant defines internal sheet tab references:

| Key | Tab Name | Purpose |
|-----|----------|---------|
| `DB_TEMPLATE` | `DB_SalesOrders` | Sales order data template |
| `ITEMS` | `DB_Items` | Items data |
| `USERS` | `Users` | User list |
| `MASTERS` | `Master` | Master data |
| `CLIENTS` | `Master_Client` | Client master data |

Note: Most data has been migrated to Supabase. These sheet tabs may be used as fallbacks or for legacy data access.

## Master Data

The `DEFAULT_MASTERS` object contains hardcoded reference data used across the app:

### Sales Order Masters
- `orderPrefixes`: ['M', 'SL']
- `salesReps`: Sales representative names
- `salesTypes`: B2B, SEZ, Export, B2C, etc.
- `categories`: Product categories (Stickers, Labels, Corrugated Box, etc.)
- `hsnGroups`: HSN code groups with GST rates
- `units`: Pcs, Kgs, Meter
- `rateTypes`: Unit, Per Unit, Per 1000, etc.
- `currencies`: INR, USD
- `jobTypes`: New, Old, Old-Revised, Repeat, Reprint
- `jobRefs`: Approved Dummy, Approved Ferrow, etc.
- `jobPrios`: Normal, Low, Medium, High

### Work Order Masters
- `paperSizes`: Standard paper sizes with dimensions
- `stocks`: Paper stock types
- `gsmList`: Available GSM values
- `departments`: All production departments
- `machines`: All machines
- `machinesByDept`: Machine-to-department mapping
- `grainOptions`: With Grain, Across Grain, NA
- `printStyles`: Single Side, Front-Back, etc.
- `coatingOptions`: None, Aqueous, UV, Drip Off
- `fluteOptions`: B, E (for corrugation)

### Flexo Masters
- `flexoLabelTypes`: Label type options
- `flexoWindingDirections`: Winding direction options
- `flexoFinishedFormats`: Finished format options
- `flexoDieTypes`: Die type options
- `flexoRoutingOptions`: Routing step options
- `flexoCylinderMaster`: Cylinder specifications (teeth, inch, mm, cylinder count)

### Product Catalogs
- `M_PREFIX_TRADING_ITEMS`: 20 trading items (Ball Pen, Banner, Cap, etc.)
- `SL_PREFIX_COMMON_ITEMS`: 3 service items (Flexo Plate, Offset Plate, Die)

## Master Overrides

Runtime master data overrides are stored in Script Properties under the key `MASTER_OVERRIDES_JSON`. The `_readMasterOverrides_()` function reads these overrides, and `_mergeMasters_()` merges them with `DEFAULT_MASTERS`.

This allows adding new categories, HSN groups, or machines without changing the code.

## Company Configuration

| Constant | Value | Purpose |
|----------|-------|---------|
| `COMPANY_STATE` | `Haryana` | Used for GST intra/inter-state determination |
| `APP_SECRET_KEY` | `AJangra` | Application secret for auth |
