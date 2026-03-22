/**
 * TradeBooks — Test Data Seeder
 * Run: node seed.js
 * Creates realistic sample data for a general contractor.
 */

const { db, run, get, all, nextInvoiceNumber } = require('./db');

// ── Helpers ──────────────────────────────────────────────────────────
function categoryId(name) {
  const row = get('SELECT id FROM categories WHERE name = @name', { name });
  if (!row) throw new Error(`Category not found: ${name}`);
  return row.id;
}

// ── Seed Everything in a Transaction ─────────────────────────────────
const seed = db.transaction(() => {

  // ── Clients ──────────────────────────────────────────────────────
  const insertClient = db.prepare(`
    INSERT INTO clients (name, email, phone, address, notes)
    VALUES (@name, @email, @phone, @address, @notes)
  `);

  const c1 = insertClient.run({
    name: 'Johnson Family',
    email: 'mike.johnson@email.com',
    phone: '(512) 555-0142',
    address: '1847 Pecan Grove Ln, Austin, TX 78745',
    notes: 'Referred by Dave at church. Two-story colonial, built 1998.',
  });

  const c2 = insertClient.run({
    name: 'Martinez Residence',
    email: 'elena.martinez@email.com',
    phone: '(512) 555-0389',
    address: '4210 Ridgecrest Dr, Round Rock, TX 78681',
    notes: 'Repeat customer. Did their fence last year.',
  });

  const c3 = insertClient.run({
    name: 'Oak Street Commerce',
    email: 'properties@oakstreetcommerce.com',
    phone: '(512) 555-0771',
    address: '302 Oak Street, Georgetown, TX 78626',
    notes: 'Commercial property management company. Net-30 terms.',
  });

  console.log(`Created 3 clients (IDs: ${c1.lastInsertRowid}, ${c2.lastInsertRowid}, ${c3.lastInsertRowid})`);

  // ── Jobs ─────────────────────────────────────────────────────────
  const insertJob = db.prepare(`
    INSERT INTO jobs (name, client_id, status, address, description, budget, start_date, end_date)
    VALUES (@name, @client_id, @status, @address, @description, @budget, @start_date, @end_date)
  `);

  const j1 = insertJob.run({
    name: 'Kitchen Remodel',
    client_id: c1.lastInsertRowid,
    status: 'active',
    address: '1847 Pecan Grove Ln, Austin, TX 78745',
    description: 'Full kitchen gut and remodel. New cabinets, granite counters, tile backsplash, lighting, plumbing fixtures.',
    budget: 28500.00,
    start_date: '2026-02-10',
    end_date: null,
  });

  const j2 = insertJob.run({
    name: 'Master Bath Renovation',
    client_id: c2.lastInsertRowid,
    status: 'active',
    address: '4210 Ridgecrest Dr, Round Rock, TX 78681',
    description: 'Walk-in shower conversion, double vanity, new tile floor, updated lighting.',
    budget: 14200.00,
    start_date: '2026-03-01',
    end_date: null,
  });

  const j3 = insertJob.run({
    name: 'Office Suite Build-Out',
    client_id: c3.lastInsertRowid,
    status: 'active',
    address: '302 Oak Street, Suite 200, Georgetown, TX 78626',
    description: 'Framing, drywall, electrical, HVAC duct work for 3-office suite. Commercial permit pulled.',
    budget: 42000.00,
    start_date: '2026-01-15',
    end_date: null,
  });

  const j4 = insertJob.run({
    name: 'Deck Repair',
    client_id: c2.lastInsertRowid,
    status: 'completed',
    address: '4210 Ridgecrest Dr, Round Rock, TX 78681',
    description: 'Replace rotted joists and decking boards on rear deck. Restain.',
    budget: 4800.00,
    start_date: '2026-01-05',
    end_date: '2026-01-18',
  });

  console.log(`Created 4 jobs (IDs: ${j1.lastInsertRowid}-${j4.lastInsertRowid})`);

  // ── Expenses ─────────────────────────────────────────────────────
  const insertExpense = db.prepare(`
    INSERT INTO expenses (amount, vendor, category_id, job_id, date, notes, receipt_path, payment_method)
    VALUES (@amount, @vendor, @category_id, @job_id, @date, @notes, @receipt_path, @payment_method)
  `);

  const catMaterials    = categoryId('Materials & Supplies');
  const catSub          = categoryId('Subcontractor Labor');
  const catVehicle      = categoryId('Vehicle & Fuel');
  const catTools        = categoryId('Tools & Equipment');
  const catInsurance    = categoryId('Insurance');
  const catLicenses     = categoryId('Licenses & Permits');
  const catMeals        = categoryId('Meals');
  const catRepairs      = categoryId('Repairs & Maintenance');
  const catProfessional = categoryId('Professional Services');

  const expenses = [
    {
      amount: 3247.89, vendor: 'Home Depot', category_id: catMaterials,
      job_id: j1.lastInsertRowid, date: '2026-02-12',
      notes: 'Cabinets (6), granite slab remnants, tile backsplash material',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 1850.00, vendor: 'Tony Morales Plumbing', category_id: catSub,
      job_id: j1.lastInsertRowid, date: '2026-02-18',
      notes: 'Rough-in plumbing for kitchen sink relocation and dishwasher line',
      receipt_path: null, payment_method: 'check',
    },
    {
      amount: 489.50, vendor: "Lowe's", category_id: catMaterials,
      job_id: j2.lastInsertRowid, date: '2026-03-03',
      notes: '12x24 porcelain tile (14 boxes), thinset, grout, Schluter strips',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 2400.00, vendor: 'RC Electric LLC', category_id: catSub,
      job_id: j3.lastInsertRowid, date: '2026-02-01',
      notes: 'Electrical rough-in for 3 offices, panel upgrade, data drops',
      receipt_path: null, payment_method: 'check',
    },
    {
      amount: 78.42, vendor: 'Shell Station', category_id: catVehicle,
      job_id: null, date: '2026-03-10',
      notes: 'Diesel fill-up, work truck',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 82.15, vendor: 'Shell Station', category_id: catVehicle,
      job_id: null, date: '2026-02-24',
      notes: 'Diesel fill-up, work truck',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 349.99, vendor: 'Harbor Freight', category_id: catTools,
      job_id: null, date: '2026-02-15',
      notes: 'Miter saw stand, impact driver bit set, clamps',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 1475.00, vendor: 'State Farm', category_id: catInsurance,
      job_id: null, date: '2026-01-15',
      notes: 'Quarterly general liability premium',
      receipt_path: null, payment_method: 'transfer',
    },
    {
      amount: 250.00, vendor: 'City of Georgetown', category_id: catLicenses,
      job_id: j3.lastInsertRowid, date: '2026-01-10',
      notes: 'Commercial build-out permit fee',
      receipt_path: null, payment_method: 'check',
    },
    {
      amount: 1620.00, vendor: 'ABC Supply', category_id: catMaterials,
      job_id: j3.lastInsertRowid, date: '2026-01-22',
      notes: '5/8 drywall (80 sheets), metal studs, track, screws, tape, mud',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 18.74, vendor: 'Whataburger', category_id: catMeals,
      job_id: j1.lastInsertRowid, date: '2026-02-18',
      notes: 'Lunch with plumber on site',
      receipt_path: null, payment_method: 'cash',
    },
    {
      amount: 385.00, vendor: 'Austin Trailer Repair', category_id: catRepairs,
      job_id: null, date: '2026-02-08',
      notes: 'New tires and bearing repack on utility trailer',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 275.00, vendor: 'Garcia CPA', category_id: catProfessional,
      job_id: null, date: '2026-01-31',
      notes: 'Q4 bookkeeping review and estimated tax prep',
      receipt_path: null, payment_method: 'check',
    },
    {
      amount: 567.20, vendor: 'Home Depot', category_id: catMaterials,
      job_id: j4.lastInsertRowid, date: '2026-01-07',
      notes: 'Pressure-treated 2x10 joists, composite decking boards, deck screws',
      receipt_path: null, payment_method: 'card',
    },
    {
      amount: 89.00, vendor: 'Sherwin-Williams', category_id: catMaterials,
      job_id: j4.lastInsertRowid, date: '2026-01-16',
      notes: 'Deck stain (3 gal), brushes, roller covers',
      receipt_path: null, payment_method: 'card',
    },
  ];

  for (const e of expenses) {
    insertExpense.run(e);
  }
  console.log(`Created ${expenses.length} expenses`);

  // ── Income ───────────────────────────────────────────────────────
  const catContract   = categoryId('Contract Work');
  const catServiceCall = categoryId('Service Call');
  const catChangeOrder = categoryId('Change Order');

  const insertIncome = db.prepare(`
    INSERT INTO income (amount, client_id, job_id, category_id, date, description, payment_method, reference, invoice_id)
    VALUES (@amount, @client_id, @job_id, @category_id, @date, @description, @payment_method, @reference, @invoice_id)
  `);

  const incomeEntries = [
    {
      amount: 9500.00, client_id: c1.lastInsertRowid, job_id: j1.lastInsertRowid,
      category_id: catContract, date: '2026-02-10',
      description: 'Kitchen remodel deposit (1/3)',
      payment_method: 'check', reference: 'Check #4418', invoice_id: null,
    },
    {
      amount: 9500.00, client_id: c1.lastInsertRowid, job_id: j1.lastInsertRowid,
      category_id: catContract, date: '2026-03-05',
      description: 'Kitchen remodel progress payment (2/3)',
      payment_method: 'check', reference: 'Check #4455', invoice_id: null,
    },
    {
      amount: 4800.00, client_id: c2.lastInsertRowid, job_id: j4.lastInsertRowid,
      category_id: catContract, date: '2026-01-20',
      description: 'Deck repair — final payment',
      payment_method: 'transfer', reference: 'Zelle 01/20', invoice_id: null,
    },
    {
      amount: 7100.00, client_id: c2.lastInsertRowid, job_id: j2.lastInsertRowid,
      category_id: catContract, date: '2026-03-01',
      description: 'Master bath renovation deposit (50%)',
      payment_method: 'check', reference: 'Check #2201', invoice_id: null,
    },
    {
      amount: 14000.00, client_id: c3.lastInsertRowid, job_id: j3.lastInsertRowid,
      category_id: catContract, date: '2026-01-15',
      description: 'Office build-out deposit (1/3)',
      payment_method: 'transfer', reference: 'ACH 01/15', invoice_id: null,
    },
    {
      amount: 14000.00, client_id: c3.lastInsertRowid, job_id: j3.lastInsertRowid,
      category_id: catContract, date: '2026-02-15',
      description: 'Office build-out progress payment (2/3)',
      payment_method: 'transfer', reference: 'ACH 02/15', invoice_id: null,
    },
    {
      amount: 1250.00, client_id: c1.lastInsertRowid, job_id: j1.lastInsertRowid,
      category_id: catChangeOrder, date: '2026-03-12',
      description: 'Change order: under-cabinet lighting upgrade and outlet relocation',
      payment_method: 'check', reference: 'Check #4470', invoice_id: null,
    },
    {
      amount: 350.00, client_id: c2.lastInsertRowid, job_id: null,
      category_id: catServiceCall, date: '2026-03-15',
      description: 'Service call: diagnose and repair leaking hose bib',
      payment_method: 'cash', reference: null, invoice_id: null,
    },
  ];

  for (const i of incomeEntries) {
    insertIncome.run(i);
  }
  console.log(`Created ${incomeEntries.length} income entries`);

  // ── Invoices ─────────────────────────────────────────────────────
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (invoice_number, client_id, job_id, status, issue_date, due_date, subtotal, tax_rate, tax_amount, total, notes, paid_date)
    VALUES (@invoice_number, @client_id, @job_id, @status, @issue_date, @due_date, @subtotal, @tax_rate, @tax_amount, @total, @notes, @paid_date)
  `);

  const insertItem = db.prepare(`
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
    VALUES (@invoice_id, @description, @quantity, @unit_price, @amount, @sort_order)
  `);

  // Invoice 1 — Deck repair (paid)
  const inv1 = insertInvoice.run({
    invoice_number: 'INV-0001',
    client_id: c2.lastInsertRowid,
    job_id: j4.lastInsertRowid,
    status: 'paid',
    issue_date: '2026-01-18',
    due_date: '2026-02-01',
    subtotal: 4800.00,
    tax_rate: 0,
    tax_amount: 0,
    total: 4800.00,
    notes: 'Thank you for your business!',
    paid_date: '2026-01-20',
  });

  insertItem.run({
    invoice_id: inv1.lastInsertRowid, description: 'Remove and dispose of rotted joists and decking',
    quantity: 1, unit_price: 850.00, amount: 850.00, sort_order: 1,
  });
  insertItem.run({
    invoice_id: inv1.lastInsertRowid, description: 'Install new pressure-treated joists and composite decking',
    quantity: 1, unit_price: 2800.00, amount: 2800.00, sort_order: 2,
  });
  insertItem.run({
    invoice_id: inv1.lastInsertRowid, description: 'Sand and restain entire deck surface',
    quantity: 1, unit_price: 1150.00, amount: 1150.00, sort_order: 3,
  });

  // Invoice 2 — Office build-out progress (sent, awaiting final)
  const inv2 = insertInvoice.run({
    invoice_number: 'INV-0002',
    client_id: c3.lastInsertRowid,
    job_id: j3.lastInsertRowid,
    status: 'sent',
    issue_date: '2026-03-15',
    due_date: '2026-04-14',
    subtotal: 14000.00,
    tax_rate: 0,
    tax_amount: 0,
    total: 14000.00,
    notes: 'Final 1/3 payment. Balance due upon completion.',
    paid_date: null,
  });

  insertItem.run({
    invoice_id: inv2.lastInsertRowid, description: 'Framing, drywall, and finishing for 3-office suite',
    quantity: 1, unit_price: 8500.00, amount: 8500.00, sort_order: 1,
  });
  insertItem.run({
    invoice_id: inv2.lastInsertRowid, description: 'Electrical — panel, circuits, data drops (subcontractor)',
    quantity: 1, unit_price: 3200.00, amount: 3200.00, sort_order: 2,
  });
  insertItem.run({
    invoice_id: inv2.lastInsertRowid, description: 'HVAC duct extension and 3-zone damper install',
    quantity: 1, unit_price: 2300.00, amount: 2300.00, sort_order: 3,
  });

  console.log(`Created 2 invoices with ${3 + 3} line items`);

  // ── Summary ──────────────────────────────────────────────────────
  const totalExpenses = get('SELECT SUM(amount) AS total FROM expenses').total;
  const totalIncome   = get('SELECT SUM(amount) AS total FROM income').total;
  console.log(`\n--- Seed Summary ---`);
  console.log(`Clients:    3`);
  console.log(`Jobs:       4`);
  console.log(`Expenses:   ${expenses.length}  ($${totalExpenses.toFixed(2)})`);
  console.log(`Income:     ${incomeEntries.length}  ($${totalIncome.toFixed(2)})`);
  console.log(`Invoices:   2`);
  console.log(`Next invoice number: ${nextInvoiceNumber()}`);
  console.log(`Database: tradebooks.db`);
});

// ── Run ──────────────────────────────────────────────────────────────
try {
  seed();
  console.log('\nSeed complete.');
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
