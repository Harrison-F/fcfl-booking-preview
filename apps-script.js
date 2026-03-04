// ============================================
// FCFL Event Booking — Google Apps Script v3
// ============================================
// SETUP:
//   1. Paste this code into Apps Script editor
//   2. Go to Project Settings (gear icon) → Script Properties
//      → Add: STRIPE_SECRET_KEY = your Stripe secret key
//   3. Run setupTriggers() once
//   4. Deploy as web app (Deploy → New deployment → Web app → Anyone can access)

// ============================================
// CONFIG
// ============================================
const CONFIG = {
  SHEET_NAME: 'Event Bookings',
  FCFL_EMAIL: 'info@fatcatfablab.org',
  DEPOSIT_AMOUNT_CENTS: 5000,  // $50.00
  HOURLY_RATE_CENTS: 2000,     // $20.00
  AUTO_REFUND_HOURS: 72,
  FORM_URL: 'https://harrison-f.github.io/fcfl-booking-preview'
};

// ============================================
// STRIPE KEY — loaded from Script Properties
// ============================================
function getStripeKey() {
  const key = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY not set. Go to Project Settings → Script Properties to add it.');
  return key;
}

// ============================================
// COLUMN INDICES (1-based, matching sheet headers)
// ============================================
const COL = {
  TIMESTAMP: 1,
  NAME: 2,
  EMAIL: 3,
  EVENT_NAME: 4,
  STATUS: 5,
  DESCRIPTION: 6,
  SPACE: 7,
  DATE: 8,
  START_TIME: 9,
  END_TIME: 10,
  DURATION: 11,
  IS_FREE: 12,
  HOSTING_FEE: 13,
  DEPOSIT: 14,
  PAYMENT_STATUS: 15,
  CHECKOUT_SESSION_ID: 16,  // Header says "Deposit PI ID"
  PAYMENT_INTENT_ID: 17,    // Header says "Fee PI ID"
  NOTES: 18
};

// ============================================
// WEB APP ENDPOINT — Receives form submissions
// ============================================
function doPost(e) {
  try {
    const sheet = getOrCreateSheet();
    const params = e.parameter;

    sheet.appendRow([
      new Date(),                                    // Timestamp
      params.name,                                   // Name
      params.email,                                  // Email
      params.eventName,                              // Event Name
      'Pending',                                     // Status
      params.description,                            // Description
      params.space,                                  // Space
      params.date,                                   // Date
      params.startTimeFormatted,                     // Start Time
      params.endTimeFormatted,                       // End Time
      parseFloat(params.duration),                   // Duration (hrs)
      params.isFree === 'yes' ? 'Yes' : 'No',       // Free Event?
      parseFloat(params.hostingFee).toFixed(2),      // Hosting Fee
      '50.00',                                       // Deposit
      '',                                            // Payment Status
      '',                                            // Checkout Session ID
      '',                                            // Payment Intent ID
      params.notes || ''                             // Notes
    ]);

    // Confirmation email to requester
    MailApp.sendEmail({
      to: params.email,
      subject: `FCFL Booking Request Received: ${params.eventName}`,
      htmlBody: `
        <h2>Booking Request Received</h2>
        <p>Hi ${params.name},</p>
        <p>We've received your request to book the <strong>${params.space}</strong> at Fat Cat Fab Lab:</p>
        <ul>
          <li><strong>Event:</strong> ${params.eventName}</li>
          <li><strong>Date:</strong> ${params.date}</li>
          <li><strong>Time:</strong> ${params.startTimeFormatted} – ${params.endTimeFormatted} (${params.duration} hours)</li>
        </ul>
        <p>The FCFL board will review your request and you'll receive an email once approved.</p>
        <p>— Fat Cat Fab Lab</p>
      `
    });

    // Notify board
    MailApp.sendEmail({
      to: CONFIG.FCFL_EMAIL,
      subject: `[Action Required] New Booking Request: ${params.eventName}`,
      htmlBody: `
        <h2>New Booking Request</h2>
        <p><strong>${params.name}</strong> (${params.email}) has requested the <strong>${params.space}</strong>.</p>
        <ul>
          <li><strong>Event:</strong> ${params.eventName}</li>
          <li><strong>Date:</strong> ${params.date}</li>
          <li><strong>Time:</strong> ${params.startTimeFormatted} – ${params.endTimeFormatted} (${params.duration} hours)</li>
          <li><strong>Free event?</strong> ${params.isFree === 'yes' ? 'Yes' : 'No'}</li>
          <li><strong>Hosting fee:</strong> $${parseFloat(params.hostingFee).toFixed(2)}</li>
        </ul>
        <p><strong>Description:</strong> ${params.description}</p>
        ${params.notes ? '<p><strong>Notes:</strong> ' + params.notes + '</p>' : ''}
        <p>To approve, change the Status column to <strong>"Approved"</strong> in the Event Bookings sheet.</p>
      `
    });

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'success' })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('doPost error: ' + error.toString());
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// APPROVAL HANDLER — Fires when Status changes to "Approved"
// Installable trigger (setupTriggers creates it)
// ============================================
function onStatusChange(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const range = e.range;
  const col = range.getColumn();
  const row = range.getRow();

  if (col !== COL.STATUS) return;
  if (row <= 1) return;

  const newValue = range.getValue();
  if (newValue !== 'Approved') return;

  const rowData = sheet.getRange(row, 1, 1, 18).getValues()[0];
  const email = rowData[COL.EMAIL - 1];
  const name = rowData[COL.NAME - 1];
  const eventName = rowData[COL.EVENT_NAME - 1];
  const space = rowData[COL.SPACE - 1];
  const date = rowData[COL.DATE - 1];
  const startTime = rowData[COL.START_TIME - 1];
  const endTime = rowData[COL.END_TIME - 1];
  const duration = rowData[COL.DURATION - 1];
  const isFree = rowData[COL.IS_FREE - 1] === 'Yes';
  const hostingFee = parseFloat(rowData[COL.HOSTING_FEE - 1]) || 0;

  try {
    // Build Checkout Session line items
    const lineItems = [];

    lineItems.push({
      name: 'Security Deposit (refundable)',
      amount: CONFIG.DEPOSIT_AMOUNT_CENTS,
    });

    if (!isFree && hostingFee > 0) {
      lineItems.push({
        name: `Hosting Fee (${duration}hr × $20)`,
        amount: Math.round(hostingFee * 100),
      });
    }

    // Create Stripe Checkout Session
    const session = stripeCreateCheckoutSession(lineItems, email, row);

    sheet.getRange(row, COL.CHECKOUT_SESSION_ID).setValue(session.id);
    sheet.getRange(row, COL.PAYMENT_STATUS).setValue('Payment Link Sent');

    // Send approval + payment email
    const totalDue = 50 + (isFree ? 0 : hostingFee);

    MailApp.sendEmail({
      to: email,
      subject: `FCFL Booking Approved: ${eventName}`,
      htmlBody: `
        <h2>Your Booking Has Been Approved! 🎉</h2>
        <p>Hi ${name},</p>
        <p>Great news — your request to use the <strong>${space}</strong> has been approved:</p>
        <ul>
          <li><strong>Event:</strong> ${eventName}</li>
          <li><strong>Date:</strong> ${date}</li>
          <li><strong>Time:</strong> ${startTime} – ${endTime}</li>
        </ul>
        <h3>Payment Required</h3>
        <table style="border-collapse:collapse;">
          <tr>
            <td style="padding:4px 12px 4px 0;">Security Deposit (refundable)</td>
            <td><strong>$50.00</strong></td>
          </tr>
          ${!isFree ? `<tr>
            <td style="padding:4px 12px 4px 0;">Hosting Fee (${duration}hr × $20)</td>
            <td><strong>$${hostingFee.toFixed(2)}</strong></td>
          </tr>` : ''}
          <tr style="border-top:1px solid #ccc;">
            <td style="padding:8px 12px 4px 0;"><strong>Total</strong></td>
            <td><strong>$${totalDue.toFixed(2)}</strong></td>
          </tr>
        </table>
        <p style="margin-top:16px;">
          <a href="${session.url}" style="background:#5bbfbf;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">Complete Payment →</a>
        </p>
        <p style="margin-top:16px;font-size:0.9em;color:#666;">
          The $50 security deposit will be automatically refunded 72 hours after your event, provided the space is left clean and all rules are followed.
        </p>
        <p>— Fat Cat Fab Lab</p>
      `
    });

    Logger.log('Approval email sent for row ' + row + ': ' + eventName);

  } catch (error) {
    sheet.getRange(row, COL.PAYMENT_STATUS).setValue('Error: ' + error.toString());
    Logger.log('Approval error for row ' + row + ': ' + error.toString());
  }
}

// ============================================
// PAYMENT STATUS CHECKER — runs every 2 hours
// ============================================
function checkPaymentStatus() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const paymentStatus = row[COL.PAYMENT_STATUS - 1];
    const sessionId = row[COL.CHECKOUT_SESSION_ID - 1];
    const rowNum = i + 1;

    if (paymentStatus !== 'Payment Link Sent' || !sessionId) continue;

    try {
      const session = stripeGetCheckoutSession(sessionId);

      if (session.payment_status === 'paid') {
        sheet.getRange(rowNum, COL.PAYMENT_INTENT_ID).setValue(session.payment_intent);
        sheet.getRange(rowNum, COL.PAYMENT_STATUS).setValue('Paid');
        Logger.log('Payment confirmed for row ' + rowNum);
      } else if (session.status === 'expired') {
        sheet.getRange(rowNum, COL.PAYMENT_STATUS).setValue('Link Expired');
        Logger.log('Checkout expired for row ' + rowNum);
      }
    } catch (error) {
      Logger.log('Error checking payment for row ' + rowNum + ': ' + error.toString());
    }
  }
}

// ============================================
// AUTO-REFUND DEPOSITS — runs every 6 hours
// ============================================
function autoRefundDeposits() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[COL.STATUS - 1];
    const paymentStatus = row[COL.PAYMENT_STATUS - 1];
    const eventDateRaw = row[COL.DATE - 1];
    const paymentIntentId = row[COL.PAYMENT_INTENT_ID - 1];
    const rowNum = i + 1;

    if (status !== 'Approved' || paymentStatus !== 'Paid' || !paymentIntentId) continue;

    const eventDate = new Date(eventDateRaw);
    if (isNaN(eventDate.getTime())) continue;

    const refundAfter = new Date(eventDate.getTime() + CONFIG.AUTO_REFUND_HOURS * 60 * 60 * 1000);

    if (now >= refundAfter) {
      try {
        stripeCreateRefund(paymentIntentId, CONFIG.DEPOSIT_AMOUNT_CENTS);

        sheet.getRange(rowNum, COL.PAYMENT_STATUS).setValue('Deposit Refunded');
        sheet.getRange(rowNum, COL.STATUS).setValue('Completed');

        const email = row[COL.EMAIL - 1];
        const name = row[COL.NAME - 1];
        const eventName = row[COL.EVENT_NAME - 1];

        MailApp.sendEmail({
          to: email,
          subject: `FCFL Deposit Refunded: ${eventName}`,
          htmlBody: `
            <h2>Your Deposit Has Been Refunded ✅</h2>
            <p>Hi ${name},</p>
            <p>Your $50 security deposit for <strong>${eventName}</strong> has been refunded. You should see it back on your statement within 5-10 business days.</p>
            <p>Thanks for hosting at Fat Cat Fab Lab!</p>
            <p>— Fat Cat Fab Lab</p>
          `
        });

        Logger.log('Deposit refunded for row ' + rowNum + ': ' + eventName);
      } catch (error) {
        Logger.log('Error refunding deposit for row ' + rowNum + ': ' + error.toString());
      }
    }
  }
}

// ============================================
// STRIPE API HELPERS
// ============================================

function stripeCreateCheckoutSession(lineItems, customerEmail, sheetRow) {
  const stripeKey = getStripeKey();

  // Expire in 24 hours (Stripe max for Checkout Sessions)
  const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

  const payload = {
    'mode': 'payment',
    'customer_email': customerEmail,
    'success_url': CONFIG.FORM_URL + '?status=success',
    'cancel_url': CONFIG.FORM_URL + '?status=cancelled',
    'metadata[sheet_row]': sheetRow.toString(),
    'expires_at': expiresAt.toString(),
  };

  lineItems.forEach((item, idx) => {
    payload[`line_items[${idx}][price_data][currency]`] = 'usd';
    payload[`line_items[${idx}][price_data][product_data][name]`] = item.name;
    payload[`line_items[${idx}][price_data][unit_amount]`] = Math.round(item.amount).toString();
    payload[`line_items[${idx}][quantity]`] = '1';
  });

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(stripeKey + ':')
    },
    payload: payload,
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.error) {
    Logger.log('Stripe error: ' + JSON.stringify(result.error));
    throw new Error('Stripe: ' + result.error.message);
  }
  return result;
}

function stripeGetCheckoutSession(sessionId) {
  const stripeKey = getStripeKey();

  const response = UrlFetchApp.fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    {
      method: 'get',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(stripeKey + ':')
      },
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error('Stripe: ' + result.error.message);
  return result;
}

function stripeCreateRefund(paymentIntentId, amountCents) {
  const stripeKey = getStripeKey();

  const payload = {
    'payment_intent': paymentIntentId,
    'amount': amountCents.toString(),
  };

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/refunds', {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(stripeKey + ':')
    },
    payload: payload,
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error('Stripe: ' + result.error.message);
  return result;
}

// ============================================
// SHEET SETUP
// ============================================
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'Name', 'Email', 'Event Name', 'Status',
      'Description', 'Space', 'Date', 'Start Time', 'End Time',
      'Duration (hrs)', 'Free Event?', 'Hosting Fee', 'Deposit',
      'Payment Status', 'Deposit PI ID', 'Fee PI ID', 'Notes'
    ]);
    sheet.getRange(1, 1, 1, 18).setFontWeight('bold');
    sheet.setFrozenRows(1);

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Pending', 'Approved', 'Completed', 'Denied', 'Cancelled'])
      .build();
    sheet.getRange(2, 5, 500).setDataValidation(statusRule);
  }

  return sheet;
}

// ============================================
// SETUP — Run ONCE to create all triggers
// ============================================
function setupTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Clear existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });

  // Installable onEdit — full permissions (can send emails + call APIs)
  ScriptApp.newTrigger('onStatusChange')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  // Auto-refund deposits every 6 hours
  ScriptApp.newTrigger('autoRefundDeposits')
    .timeBased()
    .everyHours(6)
    .create();

  // Check payment status every 2 hours
  ScriptApp.newTrigger('checkPaymentStatus')
    .timeBased()
    .everyHours(2)
    .create();

  Logger.log('✅ All triggers created:');
  Logger.log('  - onStatusChange (installable onEdit)');
  Logger.log('  - autoRefundDeposits (every 6 hours)');
  Logger.log('  - checkPaymentStatus (every 2 hours)');
}

// ============================================
// MANUAL HELPERS
// ============================================

// Mark deposit as retained (rules were broken — skip auto-refund)
function captureDeposit(rowNumber) {
  const sheet = getOrCreateSheet();
  sheet.getRange(rowNumber, COL.PAYMENT_STATUS).setValue('Deposit Retained');
  sheet.getRange(rowNumber, COL.STATUS).setValue('Completed');
  Logger.log('Deposit marked as retained for row ' + rowNumber);
}

// Test Stripe connection
function testStripeConnection() {
  try {
    const stripeKey = getStripeKey();
    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/balance', {
      method: 'get',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(stripeKey + ':')
      },
      muteHttpExceptions: true
    });
    const result = JSON.parse(response.getContentText());
    if (result.error) {
      Logger.log('❌ Stripe connection failed: ' + result.error.message);
    } else {
      Logger.log('✅ Stripe connected! Available balance: $' + (result.available[0].amount / 100).toFixed(2));
    }
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
  }
}
