# Runbook: Handling a Billing Error

## Types of Billing Errors

1. **Wrong quantity** - Billed more or less than dispatched
2. **Wrong rate** - Incorrect pricing on invoice line
3. **Wrong client/address** - Wrong bill-to or ship-to party
4. **Wrong GST** - Incorrect HSN/GST rate applied
5. **Duplicate invoice** - Same SO line billed twice

## If Invoice is Still DRAFT

Draft invoices can be freely edited or deleted.

### Edit the Draft

1. Go to Billing page (`?page=billing`)
2. Find the invoice in the list
3. Click to open the invoice editor (`billingGetInvoiceEditor`)
4. Modify lines, quantities, rates, or addresses
5. Save (`updateInvoiceDraft`)

### Delete the Draft

1. Open the invoice
2. Delete via `deleteInvoiceDraft(invoiceId, token)`
3. All `invoice_lines` are cascade-deleted
4. The billed quantities are released - SO lines become billable again

## If Invoice is POSTED

Posted invoices are **locked** at the database level. The trigger `trg_lock_invoice_lines` prevents any UPDATE or DELETE on `invoice_lines` for posted invoices. You cannot edit or delete a posted invoice.

### Option 1: Cancel and Re-issue

1. Cancel the posted invoice (set status to CANCELLED)
   - This releases the billed quantities
   - The `so_line_billed_qty` view excludes cancelled invoices
2. Create a new correct invoice
3. Post the new invoice

**Note**: Cancellation does not delete the record - it remains in the register for audit trail. The `v_billing_document_register` view shows cancelled invoices.

### Option 2: Issue a Credit Note (Manual)

If the business process requires a credit note instead of cancellation:
1. Create a new invoice with negative quantities (manual billing mode)
2. Post the credit note
3. Create the corrected invoice

## Over-Billing Prevention

The system prevents billing more than the available quantity:

- **Dispatch mode**: Cannot bill more than `dispatched_qty - billed_qty`
- **FG mode**: Cannot bill more than `packed_qty - billed_qty - fg_adjusted_qty`
- **Direct mode**: Cannot bill more than `order_qty - billed_qty`

The `ux_invoice_so_line` unique index prevents the same SO line from appearing twice on the same invoice.

## Checking Billing Status

Use these views to check billing state:

| View | What It Shows |
|------|--------------|
| `v_billing_invoice_usage_summary` | Total billed, posted, and draft qty per SO line |
| `v_billing_line_read_model` | Complete billing read model with all quantities |
| `v_report_unbilled_dispatch` | Dispatched but unbilled items |
| `so_line_billed_qty` | Simple billed qty per SO line (excludes cancelled) |

## Common Scenarios

### Wrong Quantity on Posted Invoice

1. Cancel the original invoice
2. Verify dispatch/packing records are correct
3. Create new invoice with correct quantity
4. Post the new invoice

### Client Address Changed After Posting

1. Update client parties in the Masters module
2. Cancel the original invoice
3. Create new invoice (will pick up new address)
4. Post the new invoice

### GST Rate Error

1. Verify the correct HSN group and GST rate in the Items master
2. Cancel the incorrect invoice
3. Create new invoice (will calculate correct GST split)
4. Post the new invoice

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Cannot edit invoice | Invoice is POSTED | Cancel and re-issue |
| "Invoice line locked" error | Trigger preventing edit on posted invoice | This is by design - cancel instead |
| Billable qty shows 0 | Already fully billed | Check `v_billing_invoice_usage_summary` |
| Duplicate SO line on invoice | Bug or manual error | Prevented by `ux_invoice_so_line` unique index |
