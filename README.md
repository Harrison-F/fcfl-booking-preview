# FCFL Event Booking System — Setup Guide

## Overview
This is a complete event/class booking system for Fat Cat Fab Lab. Members fill out a form, the board approves in a Google Sheet, Stripe handles payments (with a refundable $50 auth hold deposit), and deposits auto-release 72 hours after the event.

## Files
- `index.html` — The booking form (host on fatcatfablab.org or anywhere)
- `apps-script.js` — Google Apps Script backend (paste into Apps Script editor)

---

## Step 1: Set Up the Google Sheet

1. Open the FCFL Google Sheet (or create a new one)
2. Go to **Extensions → Apps Script**
3. Delete any existing code in `Code.gs`
4. Copy the entire contents of `apps-script.js` and paste it in
5. Click **Save** (💾)

## Step 2: Create the Sheet Tab

1. In the Apps Script editor, run the function `getOrCreateSheet` (click the dropdown next to ▶️, select it, then click ▶️)
2. This creates the "Event Bookings" tab with proper headers and validation
3. You may need to authorize the script — click through the Google permissions prompts

## Step 3: Set Up Triggers

1. In the Apps Script editor, run `setupTriggers`
2. This creates a recurring trigger that checks every 6 hours for deposits to auto-release
3. The `onEdit` trigger is automatic (runs when anyone edits the sheet)

## Step 4: Deploy as Web App

1. In Apps Script, click **Deploy → New deployment**
2. Click the gear icon ⚙️ → select **Web app**
3. Settings:
   - Description: "FCFL Event Booking"
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the Web App URL (looks like `https://script.google.com/macros/s/XXXX/exec`)

## Step 5: Connect the Form

1. Open `index.html`
2. Find the line: `const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL';`
3. Replace with your actual Web App URL from Step 4
4. Host the file on fatcatfablab.org (or open it locally to test)

## Step 6: Switch to Live Stripe Keys (When Ready)

1. In the Apps Script code, find the `CONFIG` object at the top
2. Replace `sk_test_...` with your live secret key (`sk_live_...`)
3. Save and redeploy

---

## How It Works

### Member Flow
1. Member fills out the booking form
2. Gets a confirmation email: "Request received, board will review"
3. Board gets a notification email
4. Board changes Status to "Approved" in the sheet
5. Member gets an email with a Stripe payment link
6. Member pays (deposit + hosting fee if applicable)
7. 72 hours after the event, deposit auto-releases
8. Member gets a "deposit released" email

### Board Flow
1. See new row appear in "Event Bookings" sheet
2. Review the request
3. Change Status column from "Pending" to "Approved" (or "Denied")
4. Everything else is automatic
5. If a member breaks rules / leaves a mess: go to Stripe dashboard and capture the $50 deposit before 72 hours are up

### Pricing
- **Free events:** $50 deposit only (auto-refunds)
- **Paid events:** $50 deposit + $20/hr hosting fee
- **Non-member events:** Handle separately (board discretion on pricing)

---

## Stripe Notes
- **Deposits** use authorization holds (not charges). The $50 is held but not captured. If not captured within 7 days, Stripe auto-releases it.
- **No fees on released holds.** You only pay Stripe's processing fee if you capture the deposit.
- **To capture a deposit** (keep the $50 due to rule violations): Go to Stripe Dashboard → Payments → find the payment → click "Capture"
- **Hosting fees** are charged immediately (standard capture).

---

## Troubleshooting
- **Form submits but no row appears:** Check that the Apps Script web app URL is correct in index.html
- **Approval email not sending:** Make sure the script has email permissions (run any function once to trigger the auth prompt)
- **Stripe errors:** Check the Payment Status column — errors are logged there
- **Need to manually release a deposit:** Run `stripeCancelPaymentIntent('pi_xxxxx')` in the Apps Script editor with the PaymentIntent ID from the sheet
