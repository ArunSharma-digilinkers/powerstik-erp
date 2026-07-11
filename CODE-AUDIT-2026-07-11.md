# Powerstik ERP — Code & Schema Audit

**Date:** 11 July 2026
**Commit audited:** `97eb436` (branch `main`, after merging `new-development`)
**Scope:** `Code.gs` (42,672 lines), `all-schemas.txt` (30,466 lines), `docs/`, `InventoryConvert.html`

---

## How to read this document

Findings are ordered by **what will hurt you soonest**, not by how interesting they are. Every finding carries a `file:line` reference so you can go straight to the code.

Priority levels:

| Level | Meaning | Timeframe |
|---|---|---|
| **P0** | Actively exploitable. Treat as a live incident. | Today |
| **P1** | Corrupts data during normal two-user operation. | This week |
| **P2** | Produces wrong money / wrong tax on real documents. | This week |
| **P3** | Can take the whole ERP down via quota exhaustion or timeout. | This month |
| **P4** | Dead weight — safe to remove. | When convenient |
| **P5** | Documentation is wrong and will mislead whoever reads it. | When convenient |

### One important caveat, stated up front

**The 26 HTML page templates are not in this repository.** `doGet` routes to `Login`, `Menu`, `OrderForm`, `Invoice`, `WorkOrderWizard`, `PrintWO` and 20 others (`Code.gs:14967`), and none of them are committed. There is no `clasp` config either, so `Code.gs` is being hand-copied out of the Apps Script editor.

This has two consequences for this audit:

1. **We cannot see which server functions the UI calls.** In Apps Script, any function *not* ending in `_` is callable from the browser. So of the 1,129 top-level functions, the 844 private (`_`-suffixed) ones can be analysed for dead code with certainty; the 285 public ones cannot. Nothing in this document claims a public function is dead.
2. **Your UI layer is unversioned and unreviewable.** If someone breaks a template, there is no diff, no history, and no way back. This is worth fixing independently of everything else below.

---

## Executive summary

The most important thing in this report is not what we expected to find.

**`Code.gs` is a clean, well-structured file.** A full call-graph analysis found only ~88 lines of provably dead code in 42,672 — 0.2%. There is no commented-out code, no unreachable code, no leftover `test*`/`debug*` scaffolding. The team clearly knows what it is doing: `CacheService` is used correctly in six places, `SpreadsheetApp` batching is correct throughout, PostgREST batch helpers exist and are well written, and the read-model view pattern is used properly in the purchasing module.

The problems are not sloppiness. They are **three systemic gaps**, each of which was solved correctly *somewhere* in the codebase and then not applied consistently:

1. **Authorization is enforced at the page-routing layer, not the function layer.** `_canAccessPage_` gates what `doGet` renders. It does not gate `google.script.run`, which calls functions directly. Proper RBAC helpers exist (`_requireModuleAccess_`, `_requireAdmin_`) and are used ~80 times — but ~30 mutating functions, and all 12 raw database primitives, have no check at all.
2. **Read-then-write with no locking.** `LockService` is used at 8 sites. It is absent from work-order numbering, FIFO inventory allocation, dispatch balances and PO receipts — every one of which corrupts data when two people click Save at the same time. Sales-order and invoice numbering *do* get this right, via database RPCs. Work-order numbering never got the same treatment.
3. **Rounding and validation discipline exists in the billing module and nowhere else.** `_billingRound2_` is used correctly throughout billing. The sales-order module does no rounding at all.

**The security findings compound each other and should be treated as a live incident.** One exposed function leaks the password hashes; another accepts a password hash *as the password*. Together they are a complete, unauthenticated takeover of a production ERP.

---

## ⚠️ Before you start: one thing to check first

**What is the web app's "Who has access" deployment setting?** (Apps Script → Deploy → Manage deployments.)

Because this app implements its own token login (`doPost` → `loginAndGetToken`) rather than relying on Google identity, the deployment is most likely **"Anyone, even anonymous"**. If so, every P0 finding below is exploitable **by anyone on the internet who has the URL, with no login at all**.

If it is restricted to your Google Workspace, the P0 findings are "only" exploitable by any employee, bypassing all role restrictions. Still critical — just not internet-facing.

**This setting determines whether the P0 section is a fire drill or a five-alarm fire. Check it before anything else.**

---

# P0 — Security (treat as an incident)

## P0-1. The entire database is exposed to the browser

**Where:** `Code.gs:77`, `261`, `269`, `278`, `298`, `306`, `320`, `334`, `349`, `360`, `370`, `389`

All twelve raw Supabase primitives are **public functions**:

```
supabaseSelect              supabaseInsert            supabaseBulkInsert
supabaseUpsert              supabaseRpc               supabaseUpdate
supabaseDelete              supabaseDeleteMinimal     supabaseBulkInsertMinimal
supabaseInsertMinimal       supabaseUpsertMinimal     supabaseUpdateMinimal
```

In Apps Script, **any global function whose name does not end in `_` is callable from the browser via `google.script.run`.** These twelve take an arbitrary table name, arbitrary filters and an arbitrary payload; they perform **zero authorization checks**; and they execute using `SUPABASE_SERVICE_KEY` (`Code.gs:8`), the service_role key, which **bypasses Row Level Security entirely**.

**Failure scenario** — from the browser console on any ERP page:

```js
google.script.run.supabaseSelect('users', { select: '*' })      // every user + password_hash
google.script.run.supabaseDelete('invoices', {})                // PostgREST DELETE, no filter = whole table
google.script.run.supabaseUpdate('invoices', {...}, {...})      // rewrite any invoice amount
google.script.run.supabaseRpc('any_db_function', {...})         // call any of the 105 DB functions
```

The internal helpers `_supabaseFetch_` and `_getSupabaseConfig_` *are* correctly protected by the underscore convention. The public wrappers sitting on top of them negate that protection completely.

**Fix:** rename all twelve to a `_` suffix (`supabaseSelect_`, `supabaseInsert_`, …). This is **611 internal call sites** — a scripted find-and-replace, mechanical and low-risk.

> **⚠️ Check before renaming:** if the HTML templates call `google.script.run.supabaseSelect(...)` directly, the rename will break the UI. Those call sites must be replaced with proper authorized wrapper functions, not left exposed. Grep the templates for `supabaseSelect`, `supabaseRpc`, `supabaseInsert`, `supabaseUpdate`, `supabaseDelete` before you start.

---

## P0-2. You can log in using a user's password hash

**Where:** `Code.gs:9820-9824`, `Code.gs:9943-9958`

```js
// Code.gs:9820
function _verifyPassword_(plainPassword, storedHash) {
  const input = String(plainPassword || '');
  const stored = String(storedHash || '');
  return _hashPassword_(input) === stored || input === stored;   // ← second clause
}
```

The clause `input === stored` means **submitting the stored hash itself, as the password, authenticates successfully.** `loginAndGetToken` has the identical hole:

```js
// Code.gs:9943
if (hash !== user.password_hash) {
  if (password !== user.password_hash) {        // ← same fallback
    return { ok:false, msg:'Invalid credentials' };
  }
  const newHash = _hashPassword_(password);     // ← = SHA256(hash)
  supabaseUpdateMinimal('users', { id:'eq.'+user.id }, { password_hash: newHash });
}
```

**Failure scenario:** An attacker uses P0-1 to read `password_hash` for user `admin`. They submit that 64-character hex string as the password. They are now authenticated as ADMIN. The code then "auto-upgrades" the account by overwriting `password_hash` with `SHA256(hash)` — **so the real admin's password stops working and the account is locked out.** The attack is self-concealing in the worst possible way: your admin discovers it by being unable to log in.

The same hole exists in `changeOwnPassword` (`Code.gs:10317`) via `_verifyPassword_`.

**Compounding weaknesses:**
- Passwords are hashed with a **single unsalted SHA-256** (`Code.gs:9813`) — rainbow-table trivial.
- Comparison is not constant-time.
- There is **no login rate limiting and no account lockout** anywhere.

**Fix:**
1. Delete the `|| input === stored` clause (`Code.gs:9823`) and the `if (password !== user.password_hash)` fallback block (`Code.gs:9946-9958`).
2. Migrate to a salted, iterated hash (bcrypt/scrypt via a DB function, since Apps Script has no native KDF).
3. Add login rate limiting.

---

## P0-3. ~30 mutating functions have no authorization check

**Where:** verified — no `getSessionUser` / `checkPermission` / `_requireModuleAccess_` anywhere in the function body.

| Line | Function | Effect if called directly |
|---|---|---|
| `7790` | `saveWorkOrder` | create / overwrite any work order |
| `8642` | `deleteWorkOrder` | delete any work order |
| `8700` | `saveItem` | change item master rate, GST% |
| `12306` | `saveOrderWithKey` | create sales orders |
| `12643` | `updateSalesOrder` | rewrite SO lines and prices |
| `15382` / `15405` | `approveArtwork` / `unapproveArtwork` | approve artwork |
| `17087` / `17142` | `approveArtworkGroup` / `unapproveArtworkGroup` | approve artwork groups |
| `4295` / `4624` / `5044` / `5137` | `purchaseCreatePO`, `purchaseUpdatePO`, `purchaseCancelPOs`, `purchaseReceivePOLine` | create POs, post receipts |
| `31731` | `savePackingBulk` | post packing |
| `31774` | `saveDispatchBulk` | post dispatch |
| `20318` / `22633` / `22973` / `23794` | inventory item + PR mutations | inventory master / PR |
| `35137` | `invRefreshStockViewsJSON` | force matview rebuild (see P3-4) |

**Note on `saveOrderWithKey` (`Code.gs:12306`):** it accepts an `apiKey` parameter that is **never referenced anywhere in the function body** — dead security theatre. Its `username` argument is written directly to `created_by` (`Code.gs:12313`, `12507`), so **audit attribution is client-supplied and forgeable.**

**Fix:** add `_requireModuleAccess_(token, MODULE, ACTION)` as the first statement of every exposed mutating function. The helpers already exist and are used correctly ~80 times elsewhere — this is applying an existing pattern, not inventing one.

---

## P0-4. Three permission checks fail *open*

**Where:** `Code.gs:13388`, `Code.gs:13435`, `Code.gs:13209`

```js
// Code.gs:13388 — setSalesOrderLifecycleStatus
if (token) {
  const allowed = checkPermission(token, 'SALES_ORDER', 'edit');
  if (!allowed) throw new Error('Unauthorized');
}
// ...if token is undefined, NO CHECK RUNS AT ALL
```

**Failure scenario:** call the function with two arguments instead of three:

```js
google.script.run.setSalesOrderLifecycleStatus('SL/25_26/00042', 'CANCELLED')
```

`token` is `undefined` → the `if (token)` block is skipped entirely → **the sales order is cancelled with no permission check.**

`listSalesOrders` (`Code.gs:13209`) has the same shape: `const currentUser = tokenText ? getSessionUser(tokenText) : null;`. With `currentUser === null`, the row-level sales-rep ownership filter at `Code.gs:13300` is skipped — so calling it **without** a token returns **every sales order in the system, with full pricing**.

**Fix:** invert the logic. Require the token; throw if it is missing.

```js
const user = getSessionUser(token);
if (!user) throw new Error('Unauthorized');
if (!checkPermission(token, 'SALES_ORDER', 'edit')) throw new Error('Unauthorized');
```

---

## P0-5. Hardcoded credential in committed source

**Where:** `Code.gs:563`

```js
const APP_SECRET_KEY = 'AJangra';
```

Unreferenced anywhere in the codebase — but it is a committed credential and it is in git history. **Delete it and rotate anything it was ever used for.**

---

## P0-6. Session tokens travel in URL query strings

**Where:** `Code.gs:14929`, `Code.gs:29215`, `Code.gs:15107`

Tokens are passed as `?token=...` and stored in `localStorage`. Query-string tokens leak into browser history, `Referer` headers, and Google's access logs. Combined with a 12-hour absolute lifetime (`Code.gs:9800`), **a shared print URL is a working session**.

Tokens are also bare `Utilities.getUuid()` (`Code.gs:9981`) — unsigned, so they carry no integrity protection.

---

# P1 — Data corruption under concurrent use

`LockService` appears at only 8 sites (`13792`, `16848`, `18156`, `18267`, `21004`, `22681`, `23664`, and one other). **None of them protect the paths below.** Each of these corrupts data when two users act at the same time — which is the normal operating condition of an ERP, not an edge case.

## P1-1. FIFO lot allocation — phantom inventory

**Where:** `Code.gs:21901-21906`

```js
supabaseUpdateMinimal('inv_lots', { id: 'eq.' + part.lotId }, {
  qty_available: Number((Number(part.availableQty || 0) - Number(part.qty || 0)).toFixed(6))
});
```

`part.availableQty` was read earlier by `invSelectOpenLotsForAllocation_` (`Code.gs:21833`). This writes an **absolute value derived from a stale read** — not an atomic decrement. `invAllocateLots_` checks sufficiency at `Code.gs:21886` and then writes: a textbook time-of-check-to-time-of-use race.

**Failure scenario:** Lot L has `qty_available = 100`. Two operators each issue 30 to different work orders simultaneously. Both read `100`. Both write `70`. **Sixty units left the floor; the system says thirty did. Thirty units of material have been conjured into existence**, and stock valuation is wrong from that moment on. This repeats on every issue, every sheet conversion, and every return-to-store.

**Fix:** wrap the issue path in `LockService.getScriptLock()`, or — better — move allocation + ledger append + lot decrement into a single transactional Postgres RPC. (This also fixes P3-3.)

## P1-2. Work-order numbers collide

**Where:** `Code.gs:5777-5800`

```js
const seq = supabaseSelect('wo_sequence', { limit: 1 })[0];
const next = (seq.last_no || 0) + 1;
supabaseUpdate('wo_sequence', { id: 'eq.' + seq.id }, { last_no: next });
return next;
```

No lock, no database sequence, no unique-violation retry. `saveWorkOrder` (`Code.gs:7790`) takes no lock either.

**Failure scenario:** Two planners click Save within the same second. Both read `last_no = 812`. Both write `813`. **Both receive WO number `J00813/25-26`.** Production entries, material issues (`refNo: payload.workOrderNo`, `Code.gs:24766`) and costing then cross-contaminate between two unrelated jobs.

**This is already solved correctly elsewhere in your codebase.** Sales orders use a DB RPC (`generate_so_number`, `Code.gs:12282`); invoices use `get_next_invoice_no` plus a unique-constraint retry loop (`Code.gs:29308`, `29339`). Apply the same pattern to the WO series.

**Secondary bug:** `getNextWONumber()` (`Code.gs:5824`) **increments the sequence just to show a preview**. Every time a user opens the WO form and abandons it, a number is permanently burned, leaving gaps in a document series that may need to be explained to an auditor.

## P1-3. Dispatch can exceed packed quantity

**Where:** `Code.gs:31797-31827`

Reads dispatch totals, computes `balance = packed_qty − dispatched`, throws if `qty > balance`, then bulk-inserts at `Code.gs:31849`. The check-then-write window is unprotected.

**Failure scenario:** 100 packed, 0 dispatched. Two clerks each submit 80. Both read `dispatched = 0`, both see `balance = 100`, both pass the check, both insert. **160 units dispatched against 100 packed** → negative finished-goods stock and over-billing downstream.

## P1-4. PO receipt lost update

**Where:** `Code.gs:5155-5190`

`received_qty` is written as `Number(pr.received_qty || 0) + qty` — an absolute SET from a stale read, with no lock.

**Failure scenario:** PR requested 500, received 200. Two GRNs of 150 post concurrently. Both read `200`, both write `350`. **300 units were actually received; the PR shows 350 and stays OPEN with a wrong pending balance.**

Note the bulk GRN path (`Code.gs:23664`) *does* take a script lock. This single-line path does not, and the two are not mutually exclusive — so the lock provides no protection.

---

# P2 — Money and tax correctness

## P2-1. Posting an invoice silently drops packing and "other" charges

**Where:** `Code.gs:31466-31472`

The draft header correctly includes them (`Code.gs:30147`: `subtotal + taxTotal + freight + packing + other`). The post path does not:

```js
const grandTotal = _billingRound2_(calcSubtotal + calcTax + freight);   // no packing, no other
```

**Failure scenario:** Draft invoice — subtotal ₹10,000, tax ₹1,800, freight ₹300, packing ₹500, other ₹200 → draft `grand_total` = **₹12,800**. User clicks Post. Recomputed `grand_total` = 10,000 + 1,800 + 300 = **₹12,100**. **₹700 of billed charges vanish from the posted tax invoice.**

Worse, when `freight = 0` but packing > 0, the `inferredFreight` calculation (`Code.gs:31466`) **absorbs packing and other into freight** and taxes them at the freight GST rate instead of their own.

## P2-2. GST intra/inter-state split comes from an unvalidated client field

**Where:** `Code.gs:12380-12382`, and `Code.gs:12709-12711`

```js
const intra = (h.clientState || '').toLowerCase() === (DEFAULT_MASTERS.companyState || COMPANY_STATE).toLowerCase();
```

`clientState` is taken **verbatim from the browser payload**. `_salesOrderNormalizeHeader_` never populates it, and `saveOrderWithKey` never looks the customer's state up from the `clients` table.

**Failure scenario:** The front end omits `clientState`, or the client master's `state` is blank. `intra` evaluates to `false` for a same-state customer → **IGST 18% is charged instead of CGST 9% + SGST 9%** on a purely intra-state supply. The invoice is legally wrong, the customer cannot claim input tax credit correctly, and GSTR-1 is misreported.

Same class of bug in `_billingCalcTaxSplit_` (`Code.gs:27565`), where a blank `partyState` falls through to IGST.

**Fix:** resolve the customer's state server-side from the `clients` master. Never trust it from the payload.

## P2-3. Client-supplied GST% overrides the item master; a failed lookup yields 0% GST

**Where:** `_salesOrderLineGstPct_`

```js
const lineGst = Number(line && (line.gstPercent || line.gst_pct) || 0);
if (lineGst > 0) return lineGst;    // client value wins over the master
// ...
return 0;                            // silent fallback
```

`_salesOrderItemTaxMap_` wraps its `items` lookup in `try { ... } catch (err) { Logger.log(...) }`.

**Failure scenario:** The `items` batch select times out. The tax map is empty. `_salesOrderLineGstPct_` returns **0**. The sales order is written with `gst_pct = 0` and `grand_total = net`. Validation (`Code.gs:12328`) checks only qty and rate — **so a zero-tax order saves cleanly** and is later billed at 0% GST.

## P2-4. Sales-order money math has no rounding at all

**Where:** `Code.gs:12385-12423` (and `updateSalesOrder`, `Code.gs:12702-12711`)

```js
const amount = qty * rate;
const discAmt = amount * discPct / 100;
const net = amount - discAmt;
cgstAmt = net * (gstPct/2) / 100;
const total = net + cgstAmt + sgstAmt + igstAmt;
subtotal += amount; cgst += cgstAmt; grand += total;
```

Nothing is rounded — not lines, not tax, not header totals.

**Failure scenario:** qty 3 × rate 33.33 → `amount = 99.99000000000001`. GST 18% → CGST `8.999100000000002`. `grand_total` is persisted with floating-point noise, and because the header is the sum of **unrounded** line values, `grand_total !== SUM(round(line_total))`. Reconciliation between the SO and its invoice produces permanent paise-level mismatches that surface in GST filings.

**Fix:** the billing module already has `_billingRound2_` (`Code.gs:27504`) and uses it correctly. Adopt it in the sales-order module.

## P2-5. The over-billing guard was written but never installed

**Where:** `all-schemas.txt:3159`

`public.prevent_over_billing()` is a complete `RETURNS trigger` function. It appears in **none** of the 27 `CREATE TRIGGER` statements, and nowhere in `Code.gs`.

**There is currently zero server-side protection against billing more than was ordered.** Nothing stops `invoice_lines` accumulating `billed_qty > order_qty`. The only guard is arithmetic inside `billing_job_dataset` — a **read** path, which a direct write under service_role bypasses completely.

**Fix** (read the function body first, and backfill-check for already-over-billed lines — the trigger will start rejecting edits to them):

```sql
CREATE TRIGGER trg_prevent_over_billing
  BEFORE INSERT OR UPDATE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_over_billing();
```

## P2-6. Errors are swallowed, so DB-enforced controls degrade into no-ops

**Where:** `_billingTryPostInvoiceV4_`, `Code.gs:31428`

```js
catch (err) { console.warn(...); return null; }   // and null means "RPC unavailable, use legacy"
```

**Failure scenario:** `billing_post_invoice_v4` raises a **legitimate business exception** — over-billing, an advance-payment guard, a constraint violation. The catch swallows it and returns `null`. `postInvoice` interprets `null` as "the RPC isn't deployed" and **posts the invoice anyway via the legacy path**, which performs none of those checks and applies the P2-1 total bug. **A database-enforced control silently becomes a no-op.**

The same pattern appears in `_billingTryFastDatasetRows_` (`Code.gs:28607`). A permissions error, a syntax error from a bad migration, and "feature not deployed" are all indistinguishable.

**Fix:** distinguish "function does not exist" (PostgREST `PGRST202` / 404) from every other error. Only the former should fall back. Everything else must propagate.

## P2-7. Non-transactional multi-step writes

- **`_billingReplaceInvoiceLines_` (`Code.gs:29120`)** deletes **all** invoice lines, then re-inserts them one by one. If insert #5 of 12 fails (transient 5xx, a new NOT NULL column, a 6-minute timeout), the invoice is left with **4 lines and 8 permanently lost**, while the header totals still describe 12.
- **`saveOrderWithKey` (`Code.gs:12342`)** inserts the header, then the lines. If the line insert fails, you get an **orphan SO header with a real SO number and a non-zero grand_total but zero lines** — visible in every report. Retrying with the same idempotency key rethrows forever (the key is poisoned, `Code.gs:12347`), so the user retries with a fresh key and creates a **duplicate sales order**.

---

# P3 — Performance and quota

Google Apps Script has hard limits that turn slowness into outright failure: **6-minute execution cap**, and a **daily `UrlFetchApp` quota shared across the whole app**. Each Supabase round trip costs roughly 100–300 ms.

## P3-1. `chunkSize = 10` — the quota bomb

**Where:** `Code.gs:21930`, `Code.gs:21964`

`invGetAllocationSummaryMap_` and `invGetReversalSummaryMap_` batch their lookups **ten IDs at a time**. They are called from **17 sites** with the entire row-ID array of a listing page. The listing limit (`Code.gs:21437`) is 1,000 rows by default — but **50,000 once a date filter is applied**.

| Rows on page | UrlFetch calls | Wall clock |
|---|---|---|
| 1,000 | 200 | ~40 s |
| 50,000 (date-filtered) | **10,000** | **exceeds 6-min limit; fails** |

A single date-filtered inventory register can **consume half the daily UrlFetch quota in one click** — and because the quota is shared, that takes *every other module* down with it.

**Stopgap (ship today):** change `10` → `100` at both lines. Immediate 10× reduction.

**Correct fix:** both functions are a plain `GROUP BY ledger_id` aggregate. Move them into one Postgres RPC — the ID array goes in the POST body, so there is **no URL-length limit and one round trip regardless of N**:

```sql
create function inv_allocation_summary(p_ledger_ids uuid[])
returns table(ledger_id uuid, batch_nos text, total_qty numeric)
language sql stable as $$
  select ledger_id,
         string_agg(distinct batch_no, ', ' order by batch_no),
         sum(qty)
  from inv_lot_allocations
  where ledger_id = any(p_ledger_ids)
  group by ledger_id
$$;
```

## P3-2. Whole tables downloaded to find one row

**Where:** `Code.gs:2331` / `2348`, called from `4627`, `5209`, `5211`, `5528`, `23238`, `23914`, `29460`, `29495`

`_purchaseListPOHeaders_()` and `_purchaseListPOLines_()` paginate **entire tables** with `select=*` and `maxRows: 50000`. Eight call sites then `.find()` **a single row** out of the result — on hot write paths including `purchaseUpdatePO` and PO printing.

`purchaseReceiveArtworkPOLine` hits **both** (lines 5209 and 5211): with 8,000 PO lines and 3,000 POs that is 11 paginated round trips (~2.2 s) plus **megabytes of JSON parsed in Apps Script**, to locate one line and one header. **It gets slower every month.**

**The correctly-filtered helpers already exist and are simply not used here:**

```js
// Code.gs:5209-5211  BEFORE — ~11 round trips + MBs of JSON
const line   = _purchaseListPOLines_().find(r => r.poNo === payload.poNo && r.id === payload.lineId);
const header = _purchaseListPOHeaders_().find(r => r.poNo === payload.poNo);

// AFTER — 2 round trips, ~2 KB
const line   = _purchaseGetPOLineById_(payload.poNo, payload.lineId);   // Code.gs:2363
const header = _purchaseGetPOHeaderByNo_(payload.poNo);                 // Code.gs:2337
```

## P3-3. `invPostIssueBulk` — N+1 nested inside N+1

**Where:** `Code.gs:24924`

Contains a pre-validation loop (`Code.gs:24950-24962`) that runs a full lot-selection query per group and **throws the result away**; `invPostIssue` then re-allocates from scratch. Per row it costs a lot select + a ledger insert + **one UPDATE per lot**.

**20 issue rows spanning 2 lots each = ~120 round trips ≈ 24 s. A 60-row material issue exceeds the 6-minute limit and fails outright.**

**Fix:** delete the throwaway loop; batch the lot selects; replace the per-lot UPDATE with one bulk upsert. Best: fold it into the transactional RPC from P1-1 — **120 round trips → 3.**

## P3-4. Materialized views refreshed non-concurrently, on the read path, by any user

**Where:** `all-schemas.txt:3432` (`refresh_stock_mv`), called from `Code.gs:26323`, exposed at `Code.gs:35137`

```sql
refresh materialized view public.inv_stock_mv;            -- not CONCURRENTLY
refresh materialized view public.inv_stock_analytics_mv;  -- not CONCURRENTLY
```

Plain `REFRESH MATERIALIZED VIEW` takes an **ACCESS EXCLUSIVE lock** — every reader blocks for the full rebuild. It is called from **15 sites including a read path** (`invGetStockSnapshotJSON`), the debounce is only 10 seconds, and `invRefreshStockViewsJSON` is **exposed to the client with no permission check** and calls it with `force=true`.

**Any logged-in user can serialize the entire inventory module behind repeated full rebuilds. This is a self-inflicted denial of service.**

**Fix:** both matviews already have the required UNIQUE index, so this is a one-word change — plus a `search_path` fix that closes a privilege-escalation vector (see P3-7):

```sql
CREATE OR REPLACE FUNCTION public.refresh_stock_mv() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
begin
  refresh materialized view concurrently public.inv_stock_mv;
  refresh materialized view concurrently public.inv_stock_analytics_mv;
end;
$$;
```

Then move it to a scheduled job (pg_cron) and take it off the read path entirely. **Note: there are currently no Apps Script time-based triggers at all** (`newTrigger` appears zero times), so matview freshness depends purely on user traffic.

## P3-5. `getMasters` fetches the same table twice, with no caching

**Where:** `Code.gs:865-905`

`getUnifiedMasters()` fetches `clients` at `Code.gs:871`. `getMasters()` then **fetches `clients` again** at `Code.gs:884` (with `select=*`) and overwrites the first result at `Code.gs:889`. One full round trip is wasted **on every page bootstrap**.

`getMasters` also has **zero caching** — despite `_mastersCacheVersion_` (`Code.gs:1500`) and `_touchMastersCacheVersion_` (`Code.gs:1504`) already existing for exactly this purpose, and `getWOMasters` already using `CacheService` correctly (`Code.gs:932`). There is also a double deep-clone and a double `augmentSalesOrderMasters_` call.

**Fix:** fetch `clients` once; wrap `getMasters` in the `CacheService` + version-key pattern that is already written and working next door.

## P3-6. Seven bulk-save loops issue one write per row

**Where:** `Code.gs:3328`, `12877`, `10920`, `10955`, `4818`, `5015`, `5122`

Each writes one row per `UPDATE`/`UPSERT` inside a `forEach`. **`supabaseUpsertMinimal` already accepts arrays** and is used correctly at `Code.gs:2812`, `9460`, `9677`, `21921`.

```js
// Code.gs:10953  BEFORE — 200 round trips ≈ 40 s
normalizedRows.forEach(row => supabaseUpsertMinimal('sales_client_benchmarks', row, { onConflict: 'client_code' }));

// AFTER — 1 round trip ≈ 0.3 s
supabaseUpsertMinimal('sales_client_benchmarks', normalizedRows, { onConflict: 'client_code' });
```

## P3-7. Other performance items

| Where | Issue | Fix |
|---|---|---|
| `Code.gs:18710` | `_opsLoadLifecycleRows_` runs **3 unfiltered whole-table selects** and joins them in JS; its `stageFocus`/`quickFilter`/`q` arguments are never pushed to Postgres | Build a view; ~18 round trips → 1 |
| `Code.gs:2465` | `_purchaseBuildActivePRPoLineMap_` fetches 4 full tables (one **twice**) and is O(n×m) at `Code.gs:2626` | The read-model view pattern already used at `Code.gs:3639` |
| `Code.gs:33777`, `Code.gs:549` | Batch chunk sizes of **20 and 40** — 1,000 keys becomes 50 round trips | Raise `maxFilterLength` to ~4000, chunk to ~100. Two constants; ~40 call sites get 4–5× faster |
| `Code.gs:25650` | Inserts a lot, then **re-SELECTs it to get an ID it already generated** at `Code.gs:21647` | `_supabaseFetch_` already sets `Prefer: return=representation` (`Code.gs:34`) — **every insert already returns its row.** Just return the id |
| 89 sites | `supabaseSelect` with no `select:` → `select=*` | Add explicit column lists, especially on `work_orders` (large `snapshot_json` JSONB) |
| `Code.gs:34963` | Four separate queries for one OR-search | One PostgREST `or=(...)` filter. Also add a `pg_trgm` index — leading-wildcard `ilike` is a sequential scan |
| `Code.gs:26558`, `15684`, `33029` | `.indexOf()` inside a loop → O(n²) | Use a `Set` |

---

# P4 — Redundant code that can be safely removed

**Set expectations honestly: `Code.gs` has almost no dead code.** A call-graph analysis treating all 285 public functions as reachable roots (because the HTML is missing) found **~88 lines dead out of 42,672 — 0.2%**. The removable weight is in the database and in one orphaned file.

## P4-1. `InventoryConvert.html` — delete the file (594 lines)

Fully orphaned, with git evidence:

- Commit `3af0be7` added the page plus its backend.
- Commit `059dbbf` ("dead functions removed") deleted **the route**, the `PAGE_MODULE_MAP` entry, and the backend functions — **but left the HTML file behind.**
- Today: it is absent from `ROUTES` (`Code.gs:14967`), so `doGet` **can never serve it**; 3 of the 5 functions it calls no longer exist; and its target tables (`inv_conversions`, `inv_conversion_sequences`) **no longer exist in the schema**.
- The feature was reimplemented as the live `invPostSheetConversion` (`Code.gs:25387`) against `inv_sheet_conversion*`.

**It is superseded, unroutable and backend-less. Delete it.**

## P4-2. Dead functions and constants in `Code.gs` (~88 lines)

Five private functions — zero references, and the `_` suffix means the HTML cannot reach them:

| Function | Lines |
|---|---|
| `_purchaseDerivePOStatusWithShortClose_` | 2402–2412 |
| `_billingExtractReusableManualSo_` | 29719–29731 |
| `_opsResolveDatasetRows_` | 19393–19415 |
| `_opsBuildStageDataset_` | 19353–19377 |
| `_opsRowIdentity_` | 19379–19382 |

(The last three form a closed dead cluster — they only call each other.)

Five unused top-level constants (`Code.gs:563-578`) — pre-Supabase Google Sheets leftovers: `APP_SECRET_KEY` (see **P0-5**), `SPREADSHEET_ID`, `EXTERNAL_SO_DB_ID`, `MASTER_DB_ID`, and the `SH` sheet-name object.

> **Do NOT delete `CLIENT_CREDIT_SPREADSHEET_ID`** — it is nearby and it **is** used.

> **Do NOT delete the `*Legacy_` / `*V4_` helpers** (`_listSOWithStatusLegacy_`, `_billingTryDatasetV4_`, etc.). Despite their names, every one is a **live fallback**.

> **Do NOT "deduplicate" `supabaseUpsert` and `supabaseUpsertMinimal`.** They look identical but differ in one string: `Prefer: return=representation` vs `return=minimal`. Both are used.

## P4-3. Dead database objects — 31 objects, ~11% of the schema

**The entire costing subsystem is dead** — 4 tables + 1 function, referenced only by their own triggers and each other. (`Code.gs` uses `machine_hour_rates`, but never these.)

```sql
DROP FUNCTION IF EXISTS public.activate_costing_master_revision(uuid, text);
DROP TABLE IF EXISTS public.costing_audit_log;
DROP TABLE IF EXISTS public.costing_line_items;
DROP TABLE IF EXISTS public.costing_records;
DROP TABLE IF EXISTS public.costing_master_revisions;   -- drop last: FK target
```

> **⚠️ Confirm first:** this is the one claim that depends on `Code.gs` being the **only** consumer of the database. If another client exists (a second Apps Script project, a Retool app, a BI tool), check it before dropping.

**Superseded report views** (drop children before parents — `v_report_wip_ageing_all_lines` is the live one):

```sql
DROP VIEW IF EXISTS public.v_report_wip_stage_reconciliation;
DROP VIEW IF EXISTS public.v_report_wip_stage_summary;
DROP VIEW IF EXISTS public.v_report_wip_stage_lines;
DROP VIEW IF EXISTS public.v_report_wip_ageing_summary;
DROP VIEW IF EXISTS public.v_report_wip_ageing_lines;
DROP VIEW IF EXISTS public.v_report_pre_wip_ageing_summary;
DROP VIEW IF EXISTS public.v_report_pre_wip_ageing_lines;
DROP VIEW IF EXISTS public.v_report_machine_load_machine_cleanup;
DROP VIEW IF EXISTS public.v_report_machine_load_missing_targets;
DROP VIEW IF EXISTS public.v_report_production_nop_machine_cleanup;
DROP VIEW IF EXISTS public.v_report_dispatch_register;
```

**Other dead views and functions:**

```sql
DROP VIEW IF EXISTS public.inv_stock_reconciled_v;
DROP VIEW IF EXISTS public.v_artwork_groups_active;
DROP VIEW IF EXISTS public.v_billing_division_needs_fix;
DROP VIEW IF EXISTS public.v_npd_dashboard_summary;
DROP VIEW IF EXISTS public.v_purchase_plate_die_jobs;
DROP VIEW IF EXISTS public.v_sales_order_advance_payment_clearance;

DROP FUNCTION IF EXISTS public.backfill_missing_sales_order_artworks();   -- one-shot migration
DROP FUNCTION IF EXISTS public.gen_item_code();
DROP FUNCTION IF EXISTS public.inv_avg_rate(uuid, text);
DROP FUNCTION IF EXISTS public.inv_stock_qty(uuid, text);
DROP FUNCTION IF EXISTS public.wo_material_issue_status(text, text);
DROP FUNCTION IF EXISTS public.set_production_live_entries_updated_at();  -- trigger fn for a table that no longer exists

DROP TABLE IF EXISTS public.billing_division_bulk_fix;    -- one-off "bulk fix" artifact
DROP TABLE IF EXISTS public.checklist_notification_log;   -- written by nothing
```

> **Do NOT drop `prevent_over_billing()`** even though it is technically unreferenced. It is a **missing safety control, not dead code** — install it instead (see **P2-5**).

## P4-4. The billing register fallback cascade

The truth here is not what the version numbers suggest:

| Object | Reality |
|---|---|
| `billing_document_register_v4` | **A pure passthrough.** Its entire body is `select * from billing_document_register_v3(...)`. Called first. |
| `billing_document_register_v3` | **The actual engine.** |
| `v_billing_document_register` | Fallback #3. |
| `billing_document_register_v2` | Fallback #4. **Unreachable in practice.** Dead. |
| `billing_invoice_register` | Fallback #5. **Unreachable, and broken** — its `RETURNS TABLE` omits `billing_mode`, `total_qty`, `line_count`, `document_type` and `product_preview`, all of which the `Code.gs` mapper reads. If it ever fired, the register would render with **blank columns rather than an error.** |

Dropping `billing_document_register_v2` and `billing_invoice_register` **requires deleting the matching `Code.gs` catch-blocks (`Code.gs:28197-28260`) in the same change** — otherwise they stay "referenced" and will 404 at runtime instead of failing cleanly.

**Also:** `billing_health_check_v4()` probes for `billing_document_register_**v3**`, not the **v4** the app actually calls first. **A health check that does not check the live path is worse than no health check.**

---

# P5 — Schema integrity and indexes

## P5-1. 31 of 72 foreign keys have no index (43%)

Postgres does **not** auto-index the referencing side of a foreign key. Every unindexed FK makes the parent's `DELETE`/`UPDATE` do a **full sequential scan** of the child table.

The most damaging — `ON DELETE CASCADE` on large tables, where the cascade *is* the sequential scan:

```sql
-- production_entries is among the largest tables, and delete_work_order_with_audit()
-- triggers this cascade on EVERY work-order delete
CREATE INDEX idx_production_entries_wo_id ON public.production_entries(wo_id);

CREATE INDEX idx_invoice_lines_so_id               ON public.invoice_lines(so_id);
CREATE INDEX idx_material_indent_lines_item_id     ON public.material_indent_lines(item_id);
CREATE INDEX idx_material_indent_pr_links_indent_id ON public.material_indent_pr_links(indent_id);
CREATE INDEX idx_inv_sheet_conv_alloc_item_id      ON public.inv_sheet_conversion_allocations(item_id);
CREATE INDEX idx_inv_sheet_conv_alloc_source_lot   ON public.inv_sheet_conversion_allocations(source_lot_id);
CREATE INDEX idx_inv_sheet_conv_lines_item_id      ON public.inv_sheet_conversion_lines(item_id);
CREATE INDEX idx_inv_sheet_conversions_source_item ON public.inv_sheet_conversions(source_item_id);
CREATE INDEX idx_role_permissions_role_id          ON public.role_permissions(role_id);
CREATE INDEX idx_users_role_id                     ON public.users(role_id);
```

Plus the **entire NPD subsystem** (12 unindexed FKs, most `ON DELETE CASCADE`) and the **checklist subsystem** (6 unindexed FKs).

**The irony:** the schema has 293 indexes, 57 of them redundant — yet 43% of its foreign keys are bare. **The index budget is being spent in exactly the wrong place.**

## P5-2. 57 of 293 indexes are redundant (19%)

**28 are exact duplicates** — identical table, method, column list and predicate. Pure write amplification: every INSERT maintains both copies.

Worst offenders:
- **`work_order_routing`** carries the *same* `(wo_id)` index **three times** and the same `(wo_id, sequence_no)` family **four times**.
- **`packing_records`** has three identical `(so_line_id, packed_at DESC)` indexes.

A further **29 are prefix-redundant** (a strict leading prefix of a wider index with the same predicate).

**The 28 exact duplicates can be dropped with zero risk.** For the 29 prefix-redundant ones on the hottest tables (`sales_order_lines`, `inv_ledger`), check `pg_stat_user_indexes.idx_scan` first — a narrower index is physically smaller and may still earn its keep.

Dropping these should cut index maintenance on the hottest write paths by roughly a third, with **no read-path regression**.

*(The full 57-line drop list is available on request — omitted here for length.)*

## P5-3. Referential integrity is missing on exactly the tables billing is computed from

These four tables have **zero outgoing foreign keys**, despite all carrying `so_line_id` / `client_code` columns that are indexed and joined constantly:

| Table | Orphanable column | Missing FK |
|---|---|---|
| `dispatch_records` | `so_line_id` | → `sales_order_lines(id)` |
| `packing_records` | `so_line_id` | → `sales_order_lines(id)` |
| `fg_stock_adjustments` | `so_line_id` | → `sales_order_lines(id)` |
| `invoices` | `client_code` | → `clients(client_code)` |
| `purchase_po_receipts` | `po_line_id` | → `purchase_order_lines(id)` |

**Failure scenario:** `billing_job_dataset` derives `packed_qty`, `dispatched_qty`, `fg_adjusted_qty` and therefore **`billable_qty`** by summing these tables grouped by `so_line_id`. Delete a sales-order line and the child rows survive as orphans — the line's billable quantity silently changes. **This is the classic "we invoiced the wrong quantity and cannot explain why" bug.**

`invoice_lines` *does* have proper FKs — so the discipline exists in the codebase; it simply was not applied to the dispatch/packing/FG side.

> Clean up existing orphans before adding the constraints. **The presence of orphans is itself a finding.**

## P5-4. `invoices` has two competing tax columns, and nullable money

```
subtotal     numeric        -- nullable, no precision
tax          numeric        -- nullable, no precision   ← legacy?
grand_total  numeric        -- nullable, no precision
tax_total    numeric(18,2)  -- the real one
```

Both `tax` and `tax_total` exist on the invoice header, and three different parts of the system compute tax three different ways. **Whichever writer forgets to populate `tax_total` produces an invoice whose GST total reads zero.**

Worse: `invoice_no`, `client_code`, `invoice_date`, `subtotal` and `grand_total` are all **NULLABLE on a financial document**. `invoice_no` has a `UNIQUE` constraint — but **`UNIQUE` permits multiple NULLs**, so you can post unlimited invoices with no invoice number.

```sql
-- after deciding on tax_total and backfilling:
ALTER TABLE public.invoices DROP COLUMN tax;
ALTER TABLE public.invoices
  ALTER COLUMN invoice_no   SET NOT NULL,
  ALTER COLUMN invoice_date SET NOT NULL,
  ALTER COLUMN client_code  SET NOT NULL,
  ALTER COLUMN subtotal     SET DEFAULT 0, ALTER COLUMN subtotal    SET NOT NULL,
  ALTER COLUMN grand_total  SET DEFAULT 0, ALTER COLUMN grand_total SET NOT NULL;
```

## P5-5. Good news — money typing is clean

Worth stating explicitly, because it is the one thing that could have been catastrophic and is not:

**All 94 public tables use `numeric`. There are 277 `numeric` columns and ZERO `double precision` / `real` / `float`.** There is no float-rounding exposure anywhere in the money or quantity model at the database level. Line-level money is properly scaled and `NOT NULL`.

The rounding problem in **P2-4** is purely in the JavaScript layer, and is fixable there.

*(Minor: 12 columns use `timestamp without time zone` while their siblings use `timestamptz`. Standardize on `timestamptz`.)*

## P5-6. RLS is enabled on all 94 tables — with zero policies

```
ALTER TABLE public.<every one of 94 tables> ENABLE ROW LEVEL SECURITY;   -- 94 statements
CREATE POLICY ...                                                        -- count: 0
```

RLS-enabled with no policy means **deny-all** for `anon` and `authenticated`. But the app connects with the **service_role key**, which **bypasses RLS entirely**.

**Those 94 `ENABLE ROW LEVEL SECURITY` statements are decorative.** They provide this application zero protection, while giving a false impression of defense-in-depth in exactly the place an auditor looks first.

**The real security model is: the database fully trusts Apps Script.** Any handler that forgets `checkPermission` has unrestricted read/write on every table — which is precisely how P0-1 and P0-3 become total compromises.

**Decide, and be explicit about it:**
- **(a)** Write real RLS policies and move to the anon key with per-user JWTs. Correct, but a large project.
- **(b)** Keep the service_role model, but **drop the 94 no-op RLS statements** so nobody mistakes them for a control — and add a hard review rule that every exposed entry point calls `checkPermission` as its first statement.

## P5-7. `refresh_stock_mv` has a mutable `search_path`

Six of the seven `SECURITY DEFINER` functions correctly pin `SET search_path TO 'public'`. **`refresh_stock_mv` (`all-schemas.txt:3432`) does not** — the standard Postgres privilege-escalation vector, and one Supabase's own linter flags. Fixed by the `ALTER FUNCTION` in **P3-4**.

## P5-8. Trigger fan-out on `sales_order_lines`

`sales_order_lines` carries 5 triggers. Updating a line fires a status refresh, whose inner `UPDATE` **re-fires the artwork-ensure and rollup triggers** — so **the rollup recompute and artwork-ensure both run twice per logical change**. It is **not** an infinite loop (an idempotency predicate breaks it), but it is 2× the necessary work, and the same cascade is reachable from `invoice_lines` and `dispatch_records`.

There is also a **circular dependency between the two new approval guards**: `enforce_artwork_approval_requires_so_approval` (on `artworks`) reads `sales_order_lines`, while `enforce_so_approval_locked_after_artwork_approval` (on `sales_order_lines`) reads `artworks`. **Two concurrent transactions touching an SO line and its artwork in opposite order can deadlock.**

**Fix:** narrow `trg_sales_order_rollup_from_lines` to `AFTER INSERT OR DELETE OR UPDATE OF qty, so_id, status`, and remove `status` from the artwork-ensure trigger's column list.

---

# P6 — Documentation

The docs were last synced at commit `d5a9bdb`. **Seven commits have landed since, changing ~16,900 lines.** Since then: 26 tables, 29 views, 12 functions and 9 triggers were **added**, and nothing was removed — so the drift is mostly omission, plus a few hard errors.

## P6-1. The documented approval lifecycle is now backwards

**This is the one that will actively mislead someone.**

Two new triggers now **invert and hard-enforce** the sequence every document describes:

- `enforce_artwork_approval_requires_so_approval()` — blocks artwork approval until the SO line has **both** Accounts and Business approval.
- `enforce_so_approval_locked_after_artwork_approval()` — blocks un-approving an SO line once its artwork is approved.

| | Flow |
|---|---|
| **Docs say** (`README.md:236`, `erp-lifecycle.md:6`) | SO → Artwork → Approvals → WO |
| **Reality** | SO → **Approvals** → **Artwork** (DB-gated) → approvals **LOCKED** → WO |

And `business-rules.md:301` still calls this an advisory, view-level gate (`v_workorder_candidates`) when it is now a **hard database constraint running in the opposite direction.** Anyone debugging an approval failure with the current docs will look in exactly the wrong place.

## P6-2. ADR-001 is superseded, not merely stale

`adr-001-sheets-as-frontend.md` states the frontend is Google Sheets. **There is no Sheets UI at all.** `doGet` routes `?p=` to 27 HtmlService templates. Sheets survive only as an **inbound** integration (`syncClientCreditFromGoogleSheet()` pulls client credit data *in*) — so the one real Sheets data flow runs **opposite** to what `data-flow.md` describes.

**Mark ADR-001 `Superseded`, keep its Context as history, and write `ADR-003: Apps Script HTML Web App as Frontend`.** The `docs/sheets/` directory name is now a misnomer.

## P6-3. Per-file status

| File | Status | Key problems |
|---|---|---|
| `database/schema-overview.md` | 🔴 Badly stale | **27 tables documented nowhere in the tree** — all of NPD, material indents, sales targets, client credit, audit events. Plus column drift on `artworks`, `inv_purchase_requests`, `production_entries` |
| `database/views.md` | 🔴 Badly stale | **4 documented views do not exist**; **34 real views missing** |
| `README.md` | 🔴 Badly stale | Wrong tech stack ("Google Sheets"); "~34,200 lines / 60+ tables / 80+ views" → actually **42,672 / 94 / 115**; inverted lifecycle |
| `modules/reports.md` | 🔴 Badly stale | **8 of 15 function names do not exist in `Code.gs`**; 10 report sections undocumented. Small file, highest error density — **cheapest big win** |
| `architecture/erp-lifecycle.md` | 🟠 Badly stale | Artwork and Approvals sections must be **swapped** |
| `database/business-rules.md` | 🟠 Badly stale | 9 new triggers undocumented; Approval Gate section needs rewriting |
| `decisions/adr-001` | 🟠 Superseded | See P6-2 |
| `architecture/data-flow.md` | 🟠 Hard error | Documents `refresh_inv_stock_mv` — **the real function is `refresh_stock_mv`** |
| `architecture/overview.md` | 🟠 Moderate | `?page=` → **`?p=`**; line counts; 6 of 27 routes shown |
| `sheets/workbook-map.md` + 3 runbooks | 🟢 Minor | `?page=` → **`?p=`**; 4 missing routes |
| Module pages (sales-orders, auth-rbac, purchasing, inventory, invoicing, clients, work-orders, production, costing, packing-dispatch) | 🟢 Minor–moderate | Each missing its newest subsystem |
| `decisions/adr-002` | ✅ Accurate | No changes needed |

## P6-4. New pages required

Five substantial subsystems have **no documentation at all**:

| Page | Covers |
|---|---|
| `modules/npd.md` | Largest new subsystem — 9 tables, 4 views, 37 functions, a 15-state workflow |
| `modules/material-indent.md` | 5 tables, indent → stock review → linked PR flow |
| `modules/sales-dashboard.md` | 6 `v_sales_dashboard_*` views, targets, benchmarks, 20 `_salesCommand*_` functions |
| `modules/client-credit.md` | Credit snapshots, exposure views, approval overrides, the Google Sheet sync |
| `modules/audit-events.md` | `audit_events` (append-only), WO deletion audit, the `_audit*_` helper family |
| `decisions/adr-003-html-web-app-frontend.md` | Supersedes ADR-001 |

---

# Repository hygiene

**`git` is not your source of truth.** The repository contains `Code.gs`, `all-schemas.txt`, `docs/` and one orphaned HTML file. It does **not** contain:

- **The 26 HTML page templates** that make up the entire user interface.
- **Any `clasp` / `appsscript.json` config** — so `Code.gs` is being hand-copied out of the Apps Script editor.

Consequences: **the UI layer is unversioned, unreviewable, and unrecoverable.** There is no diff when a template changes, no history when one breaks, and no code review on the layer that calls every server function. It also makes a whole class of analysis impossible — including confirming whether the P0-1 rename is safe.

**Recommendation:** adopt `clasp` and commit the full Apps Script project, templates included. This is a prerequisite for taking the rest of this report seriously, and it is a half-day of work.

Also note: **branch `new-improvements` is fully merged and 30+ commits stale.** It looks like it holds work; it does not. Delete it.

---

# Suggested sequence of work

### Immediately — closes the incident (~1 day)

| # | Task | Finding |
|---|---|---|
| 1 | **Check the web app's "Who has access" setting** | — |
| 2 | Grep the HTML templates for direct `supabaseSelect`/`supabaseRpc` calls | P0-1 |
| 3 | Rename the 12 raw primitives to `_` (611 call sites, scripted) | **P0-1** |
| 4 | Delete the `input === stored` password fallback | **P0-2** |
| 5 | Fix the 3 fail-open token checks | **P0-4** |
| 6 | Delete `APP_SECRET_KEY` and rotate it | **P0-5** |
| 7 | Add `_requireModuleAccess_` to the ~30 unguarded mutating functions | **P0-3** |

### This week — stops data and money corruption

| # | Task | Finding |
|---|---|---|
| 8 | `LockService` (or a transactional RPC) on FIFO issue, WO numbering, dispatch, PO receipt | **P1-1 … P1-4** |
| 9 | Fix the packing/other invoice total bug | **P2-1** |
| 10 | Resolve customer state server-side for the GST split | **P2-2** |
| 11 | Adopt `_billingRound2_` in the sales-order module | **P2-4** |
| 12 | Attach `trg_prevent_over_billing` | **P2-5** |
| 13 | Make the billing fallbacks distinguish "not deployed" from "real error" | **P2-6** |

### This month — performance and cleanup

| # | Task | Finding |
|---|---|---|
| 14 | `chunkSize` 10 → 100 (one line), then the aggregate RPC | **P3-1** |
| 15 | `refresh_stock_mv`: `CONCURRENTLY` + `search_path`, move off the read path | **P3-4, P5-7** |
| 16 | Swap the 8 whole-table `.find()` calls for the existing filtered helpers | **P3-2** |
| 17 | Batch the 7 one-write-per-row loops | **P3-6** |
| 18 | Cache `getMasters`; fetch `clients` once | **P3-5** |
| 19 | Drop the 28 exact-duplicate indexes; add the 31 missing FK indexes | **P5-1, P5-2** |
| 20 | Add the missing FKs (after cleaning orphans) | **P5-3** |
| 21 | Drop the 31 dead DB objects; delete `InventoryConvert.html` | **P4-1, P4-3** |
| 22 | Adopt `clasp`; commit the HTML templates | Repo hygiene |
| 23 | Update the docs, starting with the inverted lifecycle | **P6** |

---

## Closing note

The recurring theme is worth repeating, because it should shape how this work is approached: **almost every problem in this report was already solved correctly somewhere else in this same codebase.**

Invoice numbering is race-safe; work-order numbering is not. Billing rounds its money; sales orders do not. `CacheService` is used well in six places, but not on the most-called function in the app. Batch helpers exist and are excellent — and are bypassed at the ten places where they matter most. The correctly-filtered purchase-order helpers sit *directly beside* the whole-table scans that should be calling them.

This is not a codebase that needs rewriting. **It needs its own best patterns applied consistently.** That is a much better position to be in — and it means most of the fixes above are small, local, and low-risk.
