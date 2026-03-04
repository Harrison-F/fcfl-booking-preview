# FCFL Event Booking System

Custom booking system for Fat Cat Fab Lab's two spaces (Main Space + Event Space).

**Live preview:** https://harrison-f.github.io/fcfl-booking-preview/

## Files
- `index.html` — Booking form (light/dark mode, responsive, dynamic pricing)
- `apps-script.js` — Google Apps Script backend (sheet management, Stripe, emails)

---

## How It Works

### Member Flow
1. Fill out booking form → confirmation email sent
2. Board gets notification email
3. Board approves in Google Sheet (Status → "Approved")
4. Member gets approval email with Stripe payment link
5. Member pays (deposit + hosting fee if applicable)
6. 72 hours after event → $50 deposit auto-refunded
7. Member gets "deposit refunded" email

### Board Flow
1. New row appears in "Event Bookings" sheet
2. Review the request
3. Change Status to "Approved" (or "Denied")
4. Everything else is automatic
5. If rules broken → run `captureDeposit(rowNumber)` in Apps Script to skip the refund

### Pricing
- **Free events:** $50 refundable deposit only
- **Paid events:** $50 deposit + $20/hr hosting fee
- Deposit auto-refunds 72 hours after event date

---

## Setup

### 1. Google Sheet + Apps Script
1. Open your Google Sheet → **Extensions → Apps Script**
2. Delete any existing code in `Code.gs`
3. Paste the contents of `apps-script.js` → **Save**

### 2. Set Stripe Key
1. In Apps Script editor → **Project Settings** (gear icon) → **Script Properties**
2. Add property: `STRIPE_SECRET_KEY` = your Stripe secret key
3. Run `testStripeConnection()` to verify (should log ✅)

### 3. Create Triggers
1. Run `setupTriggers()` from the function dropdown
2. This creates three triggers:
   - **onStatusChange** — installable onEdit (fires approval flow with full permissions)
   - **checkPaymentStatus** — every 2 hours (polls Stripe for payment confirmation)
   - **autoRefundDeposits** — every 6 hours (refunds deposits 72hrs after events)

### 4. Deploy Web App
1. **Deploy → New deployment → Web app**
2. Execute as: **Me** | Who has access: **Anyone**
3. Copy the Web App URL
4. Update `APPS_SCRIPT_URL` in `index.html` with that URL

### 5. Go Live
- Replace the test Stripe key in Script Properties with your live key (`sk_live_...`)
- Host `index.html` on fatcatfablab.org

---

## Sheet Columns
| Col | Header | Notes |
|-----|--------|-------|
| A | Timestamp | Auto-filled |
| B | Name | |
| C | Email | |
| D | Event Name | |
| E | Status | Dropdown: Pending / Approved / Completed / Denied / Cancelled |
| F | Description | |
| G | Space | Main Space or Event Space |
| H | Date | |
| I | Start Time | |
| J | End Time | |
| K | Duration (hrs) | Auto-calculated |
| L | Free Event? | Yes / No |
| M | Hosting Fee | $0 for free events, $20×hrs for paid |
| N | Deposit | Always $50 |
| O | Payment Status | Auto-updated by script |
| P | Deposit PI ID | Stripe Checkout Session ID |
| Q | Fee PI ID | Stripe Payment Intent ID |
| R | Notes | Optional |

## Deposit Model
Charge + refund: the full amount (deposit + any fees) is charged upfront via Stripe Checkout. The $50 deposit is automatically refunded 72 hours after the event. If rules are broken, run `captureDeposit(rowNumber)` to mark the deposit as retained (skips auto-refund).

## Troubleshooting
- **Form submits but no row:** Check the Apps Script web app URL in index.html
- **Approval email not sending:** Ensure `setupTriggers()` was run (creates installable trigger with full permissions)
- **Stripe errors:** Check Payment Status column — errors are logged there
- **Key errors:** Verify key in Project Settings → Script Properties; run `testStripeConnection()`
