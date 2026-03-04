// ============================================
// FCFL Event Booking — Google Apps Script
// ============================================
// Paste this entire file into your Apps Script editor
// (Extensions → Apps Script from your Google Sheet)

// ============================================
// CONFIG — Update these values
// ============================================
const CONFIG = {
  STRIPE_SECRET_KEY: 'YOUR_STRIPE_SECRET_KEY', // Switch to live key for production
  SHEET_NAME: 'Event Bookings',
  FCFL_EMAIL: 'info@fatcatfablab.org',
  DEPOSIT_AMOUNT: 5000, // $50.00 in cents
  HOURLY_RATE: 2000,    // $20.00 in cents
  AUTO_RELEASE_HOURS: 72
};

// ============================================
// COLUMN INDICES (1-based, matching sheet headers)
// ============================================
const COL = {
  TIMESTAMP: 1,
  NAME: 2,
  EMAIL: 3,
  EVENT_NAME: 4,
  DESCRIPTION: 5,
  SPACE: 6,
  DATE: 7,
  START_TIME: 8,
  END_TIME: 9,
  DURATION: 10,
  IS_FREE: 11,
  HOSTING_FEE: 12,
  DEPOSIT: 13,
  STATUS: 14,         // Pending → Approved → Completed
  PAYMENT_STATUS: 15, // → Deposit Link Sent → Deposit Held → Deposit Released / Deposit Captured
  DEPOSIT_PI_ID: 16,  // Stripe PaymentIntent ID for deposit
  FEE_PI_ID: 17,      // Stripe PaymentIntent ID for hosting fee
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
      params.description,                            // Description
      params.space,                                  // Space
      params.date,                                   // Date
      params.startTimeFormatted,                     // Start Time
      params.endTimeFormatted,                       // End Time
      parseFloat(params.duration),                   // Duration (hrs)
      params.isFree === 'yes' ? 'Yes' : 'No',       // Free Event?
      parseFloat(params.hostingFee).toFixed(2),      // Hosting Fee
      '50.00',                                       // Deposit
      'Pending',                                     // Status
      '',                                            // Payment Status
      '',                                            // Deposit PaymentIntent ID
      '',                                            // Fee PaymentIntent ID
      params.notes || ''                             // Notes
    ]);

    // Send confirmation email to the requester
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
        <p>To approve, change the Status column to "Approved" in the Event Bookings sheet.</p>
      `
    });

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'success' })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// APPROVAL TRIGGER — Fires when Status changes to "Approved"
// ============================================
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const range = e.range;
  const col = range.getColumn();
  const row = range.getRow();

  // Only trigger on Status column changes
  if (col !== COL.STATUS) return;
  if (e.value !== 'Approved') return;

  // Get row data
  const rowData = sheet.getRange(row, 1, 1, 18).getValues()[0];
  const email = rowData[COL.EMAIL - 1];
  const name = rowData[COL.NAME - 1];
  const eventName = rowData[COL.EVENT_NAME - 1];
  const date = rowData[COL.DATE - 1];
  const startTime = rowData[COL.START_TIME - 1];
  const endTime = rowData[COL.END_TIME - 1];
  const duration = rowData[COL.DURATION - 1];
  const isFree = rowData[COL.IS_FREE - 1] === 'Yes';
  const hostingFee = parseFloat(rowData[COL.HOSTING_FEE - 1]);

  try {
    // 1. Create deposit auth hold (manual capture)
    const depositPI = stripeCreatePaymentIntent(
      CONFIG.DEPOSIT_AMOUNT,
      `FCFL Deposit: ${eventName} (${date})`,
      email,
      'manual' // capture_method
    );

    sheet.getRange(row, COL.DEPOSIT_PI_ID).setValue(depositPI.id);

    // 2. If paid event, create hosting fee charge
    let feePI = null;
    if (!isFree && hostingFee > 0) {
      feePI = stripeCreatePaymentIntent(
        Math.round(hostingFee * 100),
        `FCFL Hosting Fee: ${eventName} (${date})`,
        email,
        'automatic' // immediate capture
      );
      sheet.getRange(row, COL.FEE_PI_ID).setValue(feePI.id);
    }

    // 3. Create Stripe Checkout session for combined payment
    const lineItems = [];

    // Deposit line item
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Security Deposit (refundable)' },
        unit_amount: CONFIG.DEPOSIT_AMOUNT
      },
      quantity: 1
    });

    // Hosting fee line item (if applicable)
    if (!isFree && hostingFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Hosting Fee (${duration}hr × $20)` },
          unit_amount: Math.round(hostingFee * 100)
        },
        quantity: 1
      });
    }

    const checkoutUrl = stripeCreateCheckoutSession(lineItems, email, depositPI.id);

    // Update payment status
    sheet.getRange(row, COL.PAYMENT_STATUS).setValue('Payment Link Sent');

    // 4. Send approval + payment email
    const totalDue = 50 + (isFree ? 0 : hostingFee);

    MailApp.sendEmail({
      to: email,
      subject: `FCFL Booking Approved: ${eventName}`,
      htmlBody: `
        <h2>Your Booking Has Been Approved! 🎉</h2>
        <p>Hi ${name},</p>
        <p>Great news — your booking request for the <strong>${rowData[COL.SPACE - 1]}</strong> has been approved:</p>
        <ul>
          <li><strong>Event:</strong> ${eventName}</li>
          <li><strong>Date:</strong> ${date}</li>
          <li><strong>Time:</strong> ${startTime} – ${endTime}</li>
        </ul>
        <h3>Payment Required</h3>
        <table style="border-collapse:collapse;">
          <tr><td style="padding:4px 12px 4px 0;">Security Deposit (refundable)</td><td><strong>$50.00</strong></td></tr>
          ${!isFree ? '<tr><td style="padding:4px 12px 4px 0;">Hosting Fee (' + duration + 'hr × $20)</td><td><strong>$' + hostingFee.toFixed(2) + '</strong></td></tr>' : ''}
          <tr style="border-top:1px solid #ccc;"><td style="padding:8px 12px 4px 0;"><strong>Total</strong></td><td><strong>$${totalDue.toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin-top:16px;">
          <a href="${checkoutUrl}" style="background:#32D011;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Complete Payment →</a>
        </p>
        <p style="margin-top:16px;font-size:0.9em;color:#666;">
          The $50 security deposit will be automatically refunded 72 hours after your event, provided the space is left clean and all rules are followed.
        </p>
        <p>— Fat Cat Fab Lab</p>
      `
    });

  } catch (error) {
    sheet.getRange(row, COL.PAYMENT_STATUS).setValue('Error: ' + error.toString());
    Logger.log('Approval error: ' + error.toString());
  }
}

// ============================================
// DAILY TRIGGER — Auto-release deposits after 72 hours
// ============================================
function autoReleaseDeposits() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) { // Skip header row
    const row = data[i];
    const status = row[COL.STATUS - 1];
    const paymentStatus = row[COL.PAYMENT_STATUS - 1];
    const eventDate = row[COL.DATE - 1];
    const depositPIId = row[COL.DEPOSIT_PI_ID - 1];

    if (status !== 'Approved' || paymentStatus !== 'Deposit Held' || !depositPIId) continue;

    // Parse event date and add 72 hours
    const eventDateObj = new Date(eventDate);
    const releaseTime = new Date(eventDateObj.getTime() + CONFIG.AUTO_RELEASE_HOURS * 60 * 60 * 1000);

    if (now >= releaseTime) {
      try {
        // Cancel (release) the auth hold
        stripeCancelPaymentIntent(depositPIId);

        const rowNum = i + 1;
        sheet.getRange(rowNum, COL.PAYMENT_STATUS).setValue('Deposit Released');
        sheet.getRange(rowNum, COL.STATUS).setValue('Completed');

        // Notify the member
        const email = row[COL.EMAIL - 1];
        const name = row[COL.NAME - 1];
        const eventName = row[COL.EVENT_NAME - 1];

        MailApp.sendEmail({
          to: email,
          subject: `FCFL Deposit Released: ${eventName}`,
          htmlBody: `
            <h2>Your Deposit Has Been Released ✅</h2>
            <p>Hi ${name},</p>
            <p>Your $50 security deposit for <strong>${eventName}</strong> has been released. You should see it back on your statement within 5-10 business days.</p>
            <p>Thanks for hosting at Fat Cat Fab Lab!</p>
            <p>— Fat Cat Fab Lab</p>
          `
        });

        Logger.log('Released deposit for row ' + rowNum + ': ' + eventName);
      } catch (error) {
        Logger.log('Error releasing deposit for row ' + (i + 1) + ': ' + error.toString());
      }
    }
  }
}

// ============================================
// STRIPE API HELPERS
// ============================================
function stripeCreatePaymentIntent(amount, description, email, captureMethod) {
  const payload = {
    amount: amount,
    currency: 'usd',
    description: description,
    receipt_email: email,
    capture_method: captureMethod,
    'payment_method_types[]': 'card'
  };

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(CONFIG.STRIPE_SECRET_KEY + ':')
    },
    payload: payload,
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);
  return result;
}

function stripeCreateCheckoutSession(lineItems, email, depositPIId) {
  // Build form-encoded payload for Checkout Session
  const payload = {
    'mode': 'payment',
    'customer_email': email,
    'success_url': 'https://fatcatfablab.org/booking-confirmed',
    'cancel_url': 'https://fatcatfablab.org/booking-cancelled',
    'metadata[deposit_pi_id]': depositPIId
  };

  // Add line items
  lineItems.forEach((item, idx) => {
    payload[`line_items[${idx}][price_data][currency]`] = item.price_data.currency;
    payload[`line_items[${idx}][price_data][product_data][name]`] = item.price_data.product_data.name;
    payload[`line_items[${idx}][price_data][unit_amount]`] = item.price_data.unit_amount;
    payload[`line_items[${idx}][quantity]`] = item.quantity;
  });

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + Utilities.base64Encode(CONFIG.STRIPE_SECRET_KEY + ':')
    },
    payload: payload,
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);
  return result.url;
}

function stripeCancelPaymentIntent(paymentIntentId) {
  const response = UrlFetchApp.fetch(
    `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/cancel`,
    {
      method: 'post',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(CONFIG.STRIPE_SECRET_KEY + ':')
      },
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);
  return result;
}

function stripeCapturePaymentIntent(paymentIntentId) {
  const response = UrlFetchApp.fetch(
    `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`,
    {
      method: 'post',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(CONFIG.STRIPE_SECRET_KEY + ':')
      },
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message);
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
      'Timestamp', 'Name', 'Email', 'Event Name', 'Description',
      'Space', 'Date', 'Start Time', 'End Time', 'Duration (hrs)',
      'Free Event?', 'Hosting Fee', 'Deposit', 'Status',
      'Payment Status', 'Deposit PI ID', 'Fee PI ID', 'Notes'
    ]);
    // Bold header row
    sheet.getRange(1, 1, 1, 18).setFontWeight('bold');
    // Freeze header
    sheet.setFrozenRows(1);
    // Set Status column dropdown validation
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Pending', 'Approved', 'Completed', 'Denied', 'Cancelled'])
      .build();
    sheet.getRange(2, COL.STATUS, 500).setDataValidation(statusRule);
  }

  return sheet;
}

// ============================================
// SETUP FUNCTION — Run once to create triggers
// ============================================
function setupTriggers() {
  // Remove existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoReleaseDeposits') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create daily trigger for auto-release
  ScriptApp.newTrigger('autoReleaseDeposits')
    .timeBased()
    .everyHours(6) // Check every 6 hours for more timely releases
    .create();

  Logger.log('Triggers set up successfully.');
}
