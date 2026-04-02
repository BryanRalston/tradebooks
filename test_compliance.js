/**
 * test_compliance.js — Contractor Compliance Suite Tests
 * TradeBooks @ http://localhost:3143
 *
 * Tests: Mileage Log, Quarterly Tax Estimator, 1099 Tracker, Email Invoice
 *
 * Run: node test_compliance.js
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BASE = 'http://localhost:3143';
const COOKIE_FILE = path.join(__dirname, 'cookies.txt');

// ── Color helpers ─────────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ── Test state ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let sessionCookie = '';
const TODAY = new Date().toISOString().slice(0, 10);

// ── Pass / fail helpers ───────────────────────────────────────────────────────
function pass(name) {
  passed++;
  console.log(`  ${GREEN}✅ PASS${RESET} ${name}`);
}

function fail(name, reason) {
  failed++;
  console.log(`  ${RED}❌ FAIL${RESET} ${name}`);
  console.log(`       ${YELLOW}↳ ${reason}${RESET}`);
}

function section(title) {
  console.log(`\n${CYAN}${BOLD}── ${title} ──${RESET}`);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Cookie':        sessionCookie,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(extraHeaders || {})
      }
    };

    const req = lib.request(options, (res) => {
      // Capture Set-Cookie on auth responses
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const match = setCookie.join(';').match(/tradebooks\.sid=([^;]+)/);
        if (match) sessionCookie = `tradebooks.sid=${match[1]}`;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* raw text */ }
        resolve({ status: res.status || res.statusCode, body: json, raw: data });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Auth setup ────────────────────────────────────────────────────────────────
async function setupAuth() {
  section('Auth Setup');

  // Check server status
  try {
    const status = await request('GET', '/api/status');
    if (status.status !== 200) throw new Error(`Status ${status.status}`);
    pass('Server is reachable');
  } catch (err) {
    fail('Server is reachable', `Cannot connect to ${BASE} — ${err.message}. Is the server running?`);
    process.exit(1);
  }

  // Check auth status
  const authStatus = await request('GET', '/api/auth/status');
  const passwordSet = authStatus.body?.passwordSet;

  if (!passwordSet) {
    console.log(`  ${YELLOW}No password set — running setup...${RESET}`);
    const setup = await request('POST', '/api/auth/setup', { password: 'test1234' });
    if (setup.status === 200 || setup.status === 201) {
      pass('Password setup successful');
    } else if (setup.status === 403) {
      // Already set, continue to login
      console.log(`  ${YELLOW}Password already set, logging in...${RESET}`);
    } else {
      fail('Password setup', `HTTP ${setup.status}: ${JSON.stringify(setup.body)}`);
      process.exit(1);
    }
  } else {
    console.log(`  ${YELLOW}Password already set — logging in...${RESET}`);
  }

  // If we don't have a session cookie yet, log in
  if (!sessionCookie) {
    const login = await request('POST', '/api/auth/login', { password: 'test1234' });
    if (login.status === 200 && login.body?.success) {
      pass('Login successful');
    } else {
      fail('Login', `HTTP ${login.status}: ${JSON.stringify(login.body)}`);
      process.exit(1);
    }
  } else {
    pass('Session established during setup');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MILEAGE LOG
// ─────────────────────────────────────────────────────────────────────────────
async function testMileage() {
  section('1. Mileage Log');
  let tripId = null;

  // POST — create a trip
  {
    const res = await request('POST', '/api/mileage', {
      date:        TODAY,
      destination: 'Home Depot',
      purpose:     'Pick up lumber',
      miles:       12.5,
      round_trip:  0
    });

    if (res.status === 201 && res.body?.id) {
      tripId = res.body.id;
      pass(`POST /api/mileage — created trip id=${tripId}`);
    } else {
      fail('POST /api/mileage — create trip', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  if (!tripId) {
    fail('GET /api/mileage — verify trip', 'Skipped: no trip created');
    fail('GET /api/mileage/summary — summary check', 'Skipped: no trip created');
    fail('PUT /api/mileage/:id — update miles', 'Skipped: no trip created');
    fail('DELETE /api/mileage/:id — delete trip', 'Skipped: no trip created');
    return;
  }

  // GET — verify trip appears
  {
    const res = await request('GET', `/api/mileage?from=${TODAY}&to=${TODAY}`);
    if (res.status !== 200) {
      fail('GET /api/mileage — verify trip appears', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    } else {
      const found = Array.isArray(res.body) && res.body.some(t => t.id === tripId);
      if (found) {
        pass(`GET /api/mileage — trip id=${tripId} appears in list`);
      } else {
        fail('GET /api/mileage — verify trip appears', `Trip id=${tripId} not found in response: ${JSON.stringify(res.body?.slice(0,3))}`);
      }
    }
  }

  // GET summary — verify aggregates
  {
    const res = await request('GET', '/api/mileage/summary?year=2025');
    if (res.status !== 200) {
      fail('GET /api/mileage/summary — structure', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    } else {
      const b = res.body;
      const hasFields = b && typeof b.totalMiles === 'number' && typeof b.deductionAmount === 'number' && typeof b.irsRate === 'number';
      if (!hasFields) {
        fail('GET /api/mileage/summary — fields present', `Missing fields: ${JSON.stringify(b)}`);
      } else {
        pass('GET /api/mileage/summary — totalMiles, deductionAmount, irsRate present');
      }

      // NOTE: summary?year=2025 won't include the trip we just created (today = 2026)
      // so we just check the shape is correct, not that totals > 0
      if (b && b.year === 2025) {
        pass('GET /api/mileage/summary — year=2025 returned correctly');
      } else {
        fail('GET /api/mileage/summary — year field', `Expected year=2025, got: ${b?.year}`);
      }
    }
  }

  // GET summary for current year — verify totals > 0 since we just added a trip
  {
    const currentYear = new Date().getFullYear();
    const res = await request('GET', `/api/mileage/summary?year=${currentYear}`);
    if (res.status !== 200) {
      fail(`GET /api/mileage/summary?year=${currentYear} — totalMiles > 0`, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    } else {
      const b = res.body;
      if (b.totalMiles > 0 && b.deductionAmount > 0) {
        pass(`GET /api/mileage/summary?year=${currentYear} — totalMiles=${b.totalMiles}, deductionAmount=${b.deductionAmount}`);
      } else {
        fail(`GET /api/mileage/summary?year=${currentYear} — totalMiles > 0`, `totalMiles=${b.totalMiles}, deductionAmount=${b.deductionAmount}`);
      }
    }
  }

  // PUT — update miles to 15
  {
    const res = await request('PUT', `/api/mileage/${tripId}`, {
      date:        TODAY,
      destination: 'Home Depot',
      purpose:     'Pick up lumber',
      miles:       15,
      round_trip:  0
    });

    if (res.status === 200 && res.body?.miles === 15) {
      pass(`PUT /api/mileage/${tripId} — miles updated to 15`);
    } else {
      fail(`PUT /api/mileage/${tripId} — update miles`, `HTTP ${res.status}, miles=${res.body?.miles}: ${JSON.stringify(res.body)}`);
    }
  }

  // DELETE — remove the trip
  {
    const del = await request('DELETE', `/api/mileage/${tripId}`);
    if (del.status !== 200 || !del.body?.success) {
      fail(`DELETE /api/mileage/${tripId}`, `HTTP ${del.status}: ${JSON.stringify(del.body)}`);
    } else {
      // Verify it's gone
      const check = await request('GET', `/api/mileage?from=${TODAY}&to=${TODAY}`);
      const stillThere = Array.isArray(check.body) && check.body.some(t => t.id === tripId);
      if (stillThere) {
        fail(`DELETE /api/mileage/${tripId} — verify gone`, `Trip still present after delete`);
      } else {
        pass(`DELETE /api/mileage/${tripId} — trip deleted and confirmed gone`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. QUARTERLY TAX ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────
async function testQuarterlyTax() {
  section('2. Quarterly Tax Estimator');

  const res = await request('GET', '/api/tax/quarterly-estimate?year=2025');

  if (res.status !== 200) {
    fail('GET /api/tax/quarterly-estimate — reachable', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    fail('GET /api/tax/quarterly-estimate — required fields', 'Skipped: request failed');
    fail('GET /api/tax/quarterly-estimate — quarters array', 'Skipped: request failed');
    fail('GET /api/tax/quarterly-estimate — Q4 due date year', 'Skipped: request failed');
    fail('GET /api/tax/quarterly-estimate — SE tax math', 'Skipped: request failed');
    fail('GET /api/tax/quarterly-estimate — disclaimer field', 'Skipped: request failed');
    return;
  }

  pass('GET /api/tax/quarterly-estimate — HTTP 200');

  const b = res.body;

  // Required top-level fields
  {
    const required = ['netProfit', 'selfEmploymentTax', 'estimatedIncomeTax', 'totalEstimatedTax', 'perQuarter', 'quarters'];
    const missing  = required.filter(f => b[f] === undefined);
    if (missing.length) {
      fail('Required fields present', `Missing: ${missing.join(', ')}`);
    } else {
      pass('Required fields: netProfit, selfEmploymentTax, estimatedIncomeTax, totalEstimatedTax, perQuarter, quarters');
    }
  }

  // Quarters array
  {
    if (!Array.isArray(b.quarters) || b.quarters.length !== 4) {
      fail('quarters array has 4 items', `Got: ${JSON.stringify(b.quarters)}`);
    } else {
      pass('quarters array has exactly 4 items');

      const qFields = ['quarter', 'dueDate', 'amount', 'label'];
      const allHaveFields = b.quarters.every(q => qFields.every(f => q[f] !== undefined));
      if (!allHaveFields) {
        fail('Each quarter has quarter, dueDate, amount, label', `${JSON.stringify(b.quarters)}`);
      } else {
        pass('Each quarter has: quarter, dueDate, amount, label');
      }
    }
  }

  // Q4 due date — must be in NEXT year (2026)
  {
    const q4 = b.quarters?.find(q => q.quarter === 4);
    if (!q4) {
      fail('Q4 due date year check', 'Q4 not found in quarters array');
    } else {
      const q4Year = parseInt(q4.dueDate?.slice(0, 4), 10);
      if (q4Year === 2026) {
        pass(`Q4 dueDate is ${q4.dueDate} (2026 — correct for tax year 2025)`);
      } else {
        fail('Q4 due date is in year 2026', `Q4 dueDate = ${q4.dueDate} (year=${q4Year})`);
      }
    }
  }

  // SE tax math: selfEmploymentTax ≈ adjustedProfit × 0.9235 × 0.153 (within 1%)
  {
    const adjustedProfit = b.adjustedProfit;
    if (adjustedProfit !== undefined && adjustedProfit > 0) {
      const expected = adjustedProfit * 0.9235 * 0.153;
      const actual   = b.selfEmploymentTax;
      const diff     = Math.abs(actual - expected);
      const tolerance = expected * 0.01;  // 1%
      if (diff <= tolerance) {
        pass(`SE tax math: ${actual} ≈ ${adjustedProfit} × 0.9235 × 0.153 = ${expected.toFixed(2)} (within 1%)`);
      } else {
        fail('SE tax math within 1%', `Expected ≈${expected.toFixed(2)}, got ${actual} (diff=${diff.toFixed(2)})`);
      }
    } else if (adjustedProfit !== undefined && adjustedProfit <= 0) {
      // SE tax should be 0 when no profit
      if (b.selfEmploymentTax === 0) {
        pass(`SE tax math: adjustedProfit=${adjustedProfit} ≤ 0, so selfEmploymentTax=0 (correct)`);
      } else {
        fail('SE tax math: no profit → SE tax should be 0', `selfEmploymentTax=${b.selfEmploymentTax}`);
      }
    } else {
      fail('SE tax math', `adjustedProfit not in response: ${JSON.stringify(b)}`);
    }
  }

  // Disclaimer field
  {
    if (typeof b.disclaimer === 'string' && b.disclaimer.length > 0) {
      pass(`disclaimer field present: "${b.disclaimer}"`);
    } else {
      fail('disclaimer field present', `Got: ${JSON.stringify(b.disclaimer)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 1099 TRACKER
// ─────────────────────────────────────────────────────────────────────────────
async function test1099() {
  section('3. 1099 Tracker');

  const VENDOR = 'Test Sub LLC';
  const YEAR   = 2025;

  // Step 1: Create an expense for the subcontractor.
  // NOTE: POST /api/expenses does NOT include is_subcontractor in its INSERT.
  // We first create the expense, then check if is_subcontractor needs special handling.
  let expenseId = null;
  {
    const res = await request('POST', '/api/expenses', {
      date:              `${YEAR}-06-15`,
      amount:            750,
      vendor:            VENDOR,
      category_id:       null,
      is_subcontractor:  1   // Server may ignore this field
    });

    if (res.status === 201 && res.body?.id) {
      expenseId = res.body.id;
      const isSubSet = res.body.is_subcontractor === 1;

      if (isSubSet) {
        pass(`POST /api/expenses with is_subcontractor=1 — created id=${expenseId}, is_subcontractor saved`);
      } else {
        // Known issue: POST /api/expenses doesn't persist is_subcontractor
        fail(
          `POST /api/expenses with is_subcontractor=1 — is_subcontractor persisted`,
          `Bug: POST /api/expenses INSERT does not include is_subcontractor column. ` +
          `Expense created (id=${expenseId}) but is_subcontractor=${res.body.is_subcontractor}. ` +
          `1099 tests that follow will fail because the vendor won't appear.`
        );
      }
    } else {
      fail('POST /api/expenses (subcontractor)', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  // Step 2: Check if the vendor appears in 1099 list
  // (Will likely fail if is_subcontractor wasn't saved)
  {
    const res = await request('GET', `/api/compliance/1099?year=${YEAR}`);

    if (res.status !== 200) {
      fail('GET /api/compliance/1099 — reachable', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    } else {
      pass('GET /api/compliance/1099 — HTTP 200');

      const vendor = Array.isArray(res.body) && res.body.find(v => v.vendor === VENDOR);
      if (vendor) {
        if (vendor.needs1099 === true && vendor.totalPaid >= 600) {
          pass(`"${VENDOR}" appears with needs1099=true, totalPaid=${vendor.totalPaid}`);
        } else {
          fail(`"${VENDOR}" needs1099=true and totalPaid≥600`, `got needs1099=${vendor.needs1099}, totalPaid=${vendor.totalPaid}`);
        }
      } else {
        fail(
          `"${VENDOR}" appears in 1099 list`,
          `Not found. This is expected if POST /api/expenses doesn't save is_subcontractor. ` +
          `Root cause: the INSERT statement in server.js line ~736 omits is_subcontractor.`
        );
      }
    }
  }

  // Step 3: POST subcontractor details
  {
    const res = await request('POST', '/api/compliance/1099/details', {
      vendor_name: VENDOR,
      ein:         '12-3456789',
      address:     '123 Main St'
    });

    if (res.status === 201 || res.status === 200) {
      pass('POST /api/compliance/1099/details — details saved');
    } else {
      fail('POST /api/compliance/1099/details', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  // Step 4: GET details — verify saved
  {
    const res = await request('GET', '/api/compliance/1099/details');
    if (res.status !== 200) {
      fail('GET /api/compliance/1099/details', `HTTP ${res.status}`);
    } else {
      const found = Array.isArray(res.body) && res.body.find(d => d.vendor_name === VENDOR);
      if (found && found.ein === '12-3456789') {
        pass(`GET /api/compliance/1099/details — "${VENDOR}" with EIN ${found.ein} found`);
      } else {
        fail('GET /api/compliance/1099/details — details saved correctly', `Not found or EIN mismatch: ${JSON.stringify(res.body?.find(d => d.vendor_name === VENDOR))}`);
      }
    }
  }

  // Step 5: PATCH filed
  {
    const encodedVendor = encodeURIComponent(VENDOR);
    const res = await request('PATCH', `/api/compliance/1099/${encodedVendor}/filed`, { year: YEAR });

    if (res.status === 200 && res.body) {
      let filedYears = [];
      try { filedYears = JSON.parse(res.body.filed_years || '[]'); } catch (e) {}
      if (filedYears.includes(YEAR)) {
        pass(`PATCH /api/compliance/1099/${VENDOR}/filed — year ${YEAR} marked as filed`);
      } else {
        fail(`PATCH /api/compliance/1099/${VENDOR}/filed — year in filed_years`, `filed_years=${res.body.filed_years}`);
      }
    } else {
      fail(`PATCH /api/compliance/1099/${VENDOR}/filed`, `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  // Step 6: GET 1099 list — verify filed=true
  {
    const res = await request('GET', `/api/compliance/1099?year=${YEAR}`);
    if (res.status !== 200) {
      fail('GET /api/compliance/1099 — filed=true check', `HTTP ${res.status}`);
    } else {
      const vendor = Array.isArray(res.body) && res.body.find(v => v.vendor === VENDOR);
      if (!vendor) {
        fail(
          `GET /api/compliance/1099 — "${VENDOR}" filed=true`,
          `Vendor not in list (is_subcontractor not saved on expense — see earlier FAIL). ` +
          `This is a downstream failure of the same bug.`
        );
      } else if (vendor.filed === true) {
        pass(`GET /api/compliance/1099 — "${VENDOR}" filed=true`);
      } else {
        fail(`GET /api/compliance/1099 — "${VENDOR}" filed=true`, `filed=${vendor.filed}`);
      }
    }
  }

  // Cleanup test expense
  if (expenseId) {
    await request('DELETE', `/api/expenses/${expenseId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EMAIL INVOICE
// ─────────────────────────────────────────────────────────────────────────────
async function testEmailInvoice() {
  section('4. Email Invoice');

  // GET /api/settings — verify smtp_* fields present and smtp_pass masked
  {
    const res = await request('GET', '/api/settings');
    if (res.status !== 200) {
      fail('GET /api/settings — reachable', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    } else {
      pass('GET /api/settings — HTTP 200');

      const b = res.body;
      const smtpFields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_enabled'];
      const missingFields = smtpFields.filter(f => b[f] === undefined);

      if (missingFields.length) {
        fail(`smtp_* fields present in settings`, `Missing: ${missingFields.join(', ')}`);
      } else {
        pass(`smtp_* fields present: smtp_host, smtp_port, smtp_user, smtp_enabled`);
      }

      // smtp_pass must NOT be plaintext — must be '' or '••••'
      if (b.smtp_pass === undefined) {
        fail('smtp_pass masked (not plaintext)', 'smtp_pass field not present at all');
      } else if (b.smtp_pass === '' || b.smtp_pass === '••••') {
        pass(`smtp_pass is masked — value="${b.smtp_pass}" (not plaintext)`);
      } else {
        fail('smtp_pass masked (not plaintext)', `smtp_pass returned as plaintext: "${b.smtp_pass}"`);
      }
    }
  }

  // PUT /api/settings — set smtp_enabled=0, verify it saves
  {
    const res = await request('PUT', '/api/settings', { smtp_enabled: '0' });
    if (res.status === 200 && res.body?.success) {
      // Verify it actually saved
      const check = await request('GET', '/api/settings');
      if (check.body?.smtp_enabled === '0') {
        pass('PUT /api/settings smtp_enabled=0 — saved and verified');
      } else {
        fail('PUT /api/settings smtp_enabled=0 — verify saved', `smtp_enabled=${check.body?.smtp_enabled}`);
      }
    } else {
      fail('PUT /api/settings smtp_enabled=0', `HTTP ${res.status}: ${JSON.stringify(res.body)}`);
    }
  }

  // Get or create an invoice to test email on
  let invoiceId = null;
  {
    const listRes = await request('GET', '/api/invoices');
    if (listRes.status === 200 && Array.isArray(listRes.body) && listRes.body.length > 0) {
      invoiceId = listRes.body[0].id;
      console.log(`  ${YELLOW}ℹ Using existing invoice id=${invoiceId}${RESET}`);
    } else {
      // Need to create a client + invoice
      console.log(`  ${YELLOW}ℹ No existing invoices — creating client and invoice for test${RESET}`);

      const clientRes = await request('POST', '/api/clients', {
        name:  'Test Client',
        email: 'test@example.com',
        phone: '555-0100'
      });

      if (clientRes.status === 201 && clientRes.body?.id) {
        const clientId = clientRes.body.id;
        const invRes = await request('POST', '/api/invoices', {
          client_id:  clientId,
          issue_date: TODAY,
          due_date:   TODAY,
          items: [
            { description: 'Test labor', quantity: 1, unit_price: 100, amount: 100 }
          ]
        });
        if (invRes.status === 201 && invRes.body?.id) {
          invoiceId = invRes.body.id;
          console.log(`  ${YELLOW}ℹ Created invoice id=${invoiceId}${RESET}`);
        } else {
          fail('Create test invoice for email test', `HTTP ${invRes.status}: ${JSON.stringify(invRes.body)}`);
        }
      } else {
        fail('Create test client for email test', `HTTP ${clientRes.status}: ${JSON.stringify(clientRes.body)}`);
      }
    }
  }

  // POST /api/invoices/:id/email — with smtp_enabled=0 expect 400 "Email not configured"
  if (invoiceId) {
    const res = await request('POST', `/api/invoices/${invoiceId}/email`);
    if (res.status === 400) {
      const errMsg = res.body?.error || '';
      if (errMsg.toLowerCase().includes('email not configured') || errMsg.toLowerCase().includes('smtp')) {
        pass(`POST /api/invoices/${invoiceId}/email — correctly returns 400 "Email not configured" when smtp_enabled=0`);
      } else if (errMsg.toLowerCase().includes('email') || errMsg.toLowerCase().includes('client')) {
        // Also acceptable: client has no email
        pass(`POST /api/invoices/${invoiceId}/email — returns 400 (${errMsg}) — correct rejection`);
      } else {
        fail(`POST /api/invoices/${invoiceId}/email — 400 with correct message`, `Got 400 but message: "${errMsg}"`);
      }
    } else if (res.status === 404) {
      fail(`POST /api/invoices/${invoiceId}/email`, `Invoice not found (id=${invoiceId})`);
    } else if (res.status === 500) {
      // If SMTP not configured but server tries to send, transporter error — still means SMTP check logic may not be firing
      fail(
        `POST /api/invoices/${invoiceId}/email — should 400 before attempting send`,
        `HTTP 500: ${res.body?.error}. smtp_enabled check should have returned 400 first.`
      );
    } else {
      fail(
        `POST /api/invoices/${invoiceId}/email — expect 400 when smtp_enabled=0`,
        `HTTP ${res.status}: ${JSON.stringify(res.body)}`
      );
    }
  } else {
    fail(`POST /api/invoices/:id/email — smtp disabled test`, 'Skipped: no invoice available');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  TradeBooks — Compliance Suite Test Runner${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`  Base URL : ${BASE}`);
  console.log(`  Date     : ${TODAY}`);

  await setupAuth();
  await testMileage();
  await testQuarterlyTax();
  await test1099();
  await testEmailInvoice();

  // ── Summary ──────────────────────────────────────────────────────────
  const total = passed + failed;
  const pct = total ? Math.round((passed / total) * 100) : 0;
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Results: ${GREEN}${passed} passed${RESET}${BOLD} / ${RED}${failed} failed${RESET}${BOLD} / ${total} total (${pct}%)${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════${RESET}\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`\n${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
