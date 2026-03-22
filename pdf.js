/**
 * TradeBooks — PDF Generation
 * Professional invoices, P&L statements, and tax summaries using pdfkit.
 */

const PDFDocument = require('pdfkit');

// ── Styling Constants ───────────────────────────────────────────────
const COLORS = {
  primary:  '#2563EB',
  text:     '#0F172A',
  secondary:'#475569',
  muted:    '#94A3B8',
  green:    '#16A34A',
  red:      '#DC2626',
  border:   '#E2E8F0',
  lightBg:  '#F8FAFC'
};

const MARGIN = 50;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ── Helper Functions ────────────────────────────────────────────────

function formatCurrency(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return num < 0 ? `-$${formatted}` : `$${formatted}`;
}

function drawHorizontalRule(doc, y, color) {
  doc.strokeColor(color || COLORS.border)
     .lineWidth(0.5)
     .moveTo(MARGIN, y)
     .lineTo(PAGE_WIDTH - MARGIN, y)
     .stroke();
}

/**
 * Generic table drawer.
 * @param {PDFDocument} doc
 * @param {Array<{label:string, width:number, align:string}>} columns
 * @param {Array<Array<string>>} rows
 * @param {object} options — startY, headerFont, rowFont, rowHeight, stripeBg
 * @returns {number} The Y position after the last row.
 */
function drawTable(doc, columns, rows, options = {}) {
  const {
    startY = doc.y,
    headerFont = 'Helvetica-Bold',
    rowFont = 'Helvetica',
    fontSize = 10,
    headerFontSize = 9,
    rowHeight = 22,
    headerHeight = 26,
    stripeBg = true
  } = options;

  let y = startY;
  let x = MARGIN;

  // Header background
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerHeight)
     .fill(COLORS.primary);

  // Header text
  doc.font(headerFont).fontSize(headerFontSize).fillColor('#FFFFFF');
  for (const col of columns) {
    const textX = x + 6;
    const textOpts = { width: col.width - 12, align: col.align || 'left' };
    doc.text(col.label, textX, y + 8, textOpts);
    x += col.width;
  }

  y += headerHeight;

  // Rows
  doc.font(rowFont).fontSize(fontSize).fillColor(COLORS.text);
  for (let i = 0; i < rows.length; i++) {
    // Check page break
    if (y + rowHeight > PAGE_HEIGHT - MARGIN - 30) {
      doc.addPage();
      y = MARGIN;
    }

    // Stripe background
    if (stripeBg && i % 2 === 0) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight)
         .fill(COLORS.lightBg);
      doc.fillColor(COLORS.text);
    }

    x = MARGIN;
    for (let j = 0; j < columns.length; j++) {
      const col = columns[j];
      const cellText = rows[i][j] != null ? String(rows[i][j]) : '';
      const textX = x + 6;
      const textOpts = { width: col.width - 12, align: col.align || 'left' };
      doc.text(cellText, textX, y + 6, textOpts);
      x += col.width;
    }

    y += rowHeight;
  }

  // Bottom border
  drawHorizontalRule(doc, y);

  return y;
}

/**
 * Format a date string for display (YYYY-MM-DD → MM/DD/YYYY).
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
  return dateStr;
}

/**
 * Draw a status watermark diagonally across the page.
 */
function drawWatermark(doc, text, color) {
  doc.save();
  doc.translate(PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
  doc.rotate(-45);
  doc.font('Helvetica-Bold').fontSize(72).fillColor(color);
  doc.opacity(0.12);
  const textWidth = doc.widthOfString(text);
  doc.text(text, -textWidth / 2, -36, { lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

// ── Invoice PDF ─────────────────────────────────────────────────────

/**
 * Generate a professional contractor invoice PDF.
 * @param {object} invoiceData — invoice row from DB
 * @param {Array} items — invoice_items rows
 * @param {object} settings — key/value settings (business_name, address, phone, email, tax_id)
 * @param {object} client — client row from DB
 * @returns {PDFDocument} The readable PDF stream (already ended).
 */
function generateInvoice(invoiceData, items, settings, client) {
  const doc = new PDFDocument({ size: 'Letter', margin: MARGIN });

  const s = settings || {};
  const inv = invoiceData || {};
  const cl = client || {};

  // ── Watermark (drawn first so content overlays it) ──
  if (inv.status === 'paid') {
    drawWatermark(doc, 'PAID', COLORS.green);
  } else if (inv.status === 'draft') {
    drawWatermark(doc, 'DRAFT', COLORS.muted);
  }

  // ── Header: Business Info (left) + Invoice Label (right) ──
  let y = MARGIN;

  // Business name
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.primary);
  doc.text(s.business_name || 'Your Business', MARGIN, y, { width: CONTENT_WIDTH / 2 });
  y += 26;

  // Business details
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.secondary);
  const businessLines = [];
  if (s.address) businessLines.push(s.address);
  const contactParts = [];
  if (s.phone) contactParts.push(s.phone);
  if (s.email) contactParts.push(s.email);
  if (contactParts.length) businessLines.push(contactParts.join('  |  '));
  if (s.tax_id) businessLines.push(`Tax ID: ${s.tax_id}`);

  for (const line of businessLines) {
    doc.text(line, MARGIN, y, { width: CONTENT_WIDTH / 2 });
    y += 13;
  }

  // "INVOICE" label — right side
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.primary);
  doc.text('INVOICE', PAGE_WIDTH / 2, MARGIN, {
    width: CONTENT_WIDTH / 2,
    align: 'right'
  });

  // Invoice details — right side
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  let rightY = MARGIN + 36;
  const rightX = PAGE_WIDTH / 2;
  const rightW = CONTENT_WIDTH / 2;

  const invoiceDetails = [
    { label: 'Invoice #:', value: inv.invoice_number || '' },
    { label: 'Date:', value: formatDate(inv.issue_date) },
    { label: 'Due Date:', value: formatDate(inv.due_date) }
  ];

  for (const d of invoiceDetails) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.secondary);
    doc.text(d.label, rightX, rightY, { width: 70, align: 'right', continued: false });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.text(d.value, rightX + 76, rightY, { width: rightW - 76, align: 'right' });
    rightY += 16;
  }

  // Ensure y is below both columns
  y = Math.max(y, rightY) + 20;

  // ── Divider ──
  doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(COLORS.primary);
  y += 16;

  // ── Bill To ──
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.secondary);
  doc.text('BILL TO', MARGIN, y);
  y += 16;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
  doc.text(cl.name || 'Client', MARGIN, y);
  y += 15;

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.secondary);
  if (cl.address) { doc.text(cl.address, MARGIN, y); y += 13; }
  if (cl.email)   { doc.text(cl.email, MARGIN, y); y += 13; }
  if (cl.phone)   { doc.text(cl.phone, MARGIN, y); y += 13; }

  // ── Job Reference (right column, same row as Bill To) ──
  if (inv.job_name || inv.job_address) {
    const jobY = y - (cl.address ? 13 : 0) - (cl.email ? 13 : 0) - (cl.phone ? 13 : 0) - 15 - 16;
    const jobX = PAGE_WIDTH / 2 + 20;

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.secondary);
    doc.text('JOB REFERENCE', jobX, jobY);
    let jy = jobY + 16;

    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    if (inv.job_name) {
      doc.text(inv.job_name, jobX, jy, { width: CONTENT_WIDTH / 2 - 20 });
      jy += 14;
    }
    if (inv.job_address) {
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.secondary);
      doc.text(inv.job_address, jobX, jy, { width: CONTENT_WIDTH / 2 - 20 });
    }
  }

  y += 14;

  // ── Line Items Table ──
  const descWidth = CONTENT_WIDTH - 80 - 90 - 100;
  const tableColumns = [
    { label: 'Description', width: descWidth, align: 'left' },
    { label: 'Qty',         width: 80,        align: 'right' },
    { label: 'Unit Price',  width: 90,        align: 'right' },
    { label: 'Amount',      width: 100,       align: 'right' }
  ];

  const tableRows = (items || []).map(item => [
    item.description || '',
    item.quantity != null ? String(item.quantity) : '1',
    formatCurrency(item.unit_price),
    formatCurrency(item.amount)
  ]);

  y = drawTable(doc, tableColumns, tableRows, { startY: y });
  y += 10;

  // ── Totals Section (right-aligned) ──
  const totalsX = PAGE_WIDTH - MARGIN - 200;
  const totalsLabelX = totalsX;
  const totalsValueX = totalsX + 100;
  const totalsW = 96;

  // Subtotal
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.secondary);
  doc.text('Subtotal:', totalsLabelX, y, { width: 96, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  doc.text(formatCurrency(inv.subtotal), totalsValueX, y, { width: totalsW, align: 'right' });
  y += 18;

  // Tax
  if (inv.tax_rate && inv.tax_rate > 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.secondary);
    doc.text(`Tax (${inv.tax_rate}%):`, totalsLabelX, y, { width: 96, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
    doc.text(formatCurrency(inv.tax_amount), totalsValueX, y, { width: totalsW, align: 'right' });
    y += 18;
  }

  // Divider above total
  drawHorizontalRule(doc, y, COLORS.primary);
  y += 8;

  // Total
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.primary);
  doc.text('Total:', totalsLabelX, y, { width: 96, align: 'right' });
  doc.text(formatCurrency(inv.total), totalsValueX, y, { width: totalsW, align: 'right' });
  y += 30;

  // ── Footer ──
  if (inv.notes) {
    // Check page break
    if (y + 60 > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.secondary);
    doc.text('NOTES / TERMS', MARGIN, y);
    y += 14;

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
    doc.text(inv.notes, MARGIN, y, { width: CONTENT_WIDTH });
    y += doc.heightOfString(inv.notes, { width: CONTENT_WIDTH }) + 16;
  }

  // Thank you
  if (y + 30 > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
    y = MARGIN;
  }

  drawHorizontalRule(doc, y);
  y += 12;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted);
  doc.text('Thank you for your business!', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });

  doc.end();
  return doc;
}

// ── Profit & Loss PDF ───────────────────────────────────────────────

/**
 * Generate a Profit & Loss statement PDF.
 * @param {object} data — { period: {from, to}, income: [{category, amount}], expenses: [{category, amount}], totalIncome, totalExpenses, netProfit }
 * @param {object} settings — business settings
 * @returns {PDFDocument}
 */
function generatePnL(data, settings) {
  const doc = new PDFDocument({ size: 'Letter', margin: MARGIN });

  const s = settings || {};
  const d = data || {};

  let y = MARGIN;

  // ── Header ──
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.primary);
  doc.text(s.business_name || 'Your Business', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 24;

  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.text);
  doc.text('Profit & Loss Statement', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 28;

  doc.font('Helvetica').fontSize(11).fillColor(COLORS.secondary);
  const periodFrom = formatDate(d.period?.from) || 'Start';
  const periodTo = formatDate(d.period?.to) || 'End';
  doc.text(`Period: ${periodFrom} to ${periodTo}`, MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 14;

  // Decorative line under header
  doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(COLORS.primary);
  y += 24;

  // ── Income Section ──
  doc.rect(MARGIN, y, CONTENT_WIDTH, 28).fill(COLORS.lightBg);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.green);
  doc.text('INCOME', MARGIN + 10, y + 7, { width: CONTENT_WIDTH - 20 });
  y += 36;

  const incomeItems = d.income || [];
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  for (const item of incomeItems) {
    if (y + 20 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

    doc.text(item.category || 'Uncategorized', MARGIN + 20, y, {
      width: CONTENT_WIDTH - 140
    });
    doc.text(formatCurrency(item.amount), PAGE_WIDTH - MARGIN - 110, y, {
      width: 100,
      align: 'right'
    });
    y += 20;
  }

  // Total Income
  if (y + 30 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }
  drawHorizontalRule(doc, y);
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
  doc.text('Total Income', MARGIN + 20, y, { width: CONTENT_WIDTH - 140 });
  doc.text(formatCurrency(d.totalIncome), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });
  y += 30;

  // ── Expenses Section ──
  doc.rect(MARGIN, y, CONTENT_WIDTH, 28).fill(COLORS.lightBg);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.red);
  doc.text('EXPENSES', MARGIN + 10, y + 7, { width: CONTENT_WIDTH - 20 });
  y += 36;

  const expenseItems = d.expenses || [];
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  for (const item of expenseItems) {
    if (y + 20 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

    doc.text(item.category || 'Uncategorized', MARGIN + 20, y, {
      width: CONTENT_WIDTH - 140
    });
    doc.text(formatCurrency(item.amount), PAGE_WIDTH - MARGIN - 110, y, {
      width: 100,
      align: 'right'
    });
    y += 20;
  }

  // Total Expenses
  if (y + 30 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }
  drawHorizontalRule(doc, y);
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
  doc.text('Total Expenses', MARGIN + 20, y, { width: CONTENT_WIDTH - 140 });
  doc.text(formatCurrency(d.totalExpenses), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });
  y += 30;

  // ── Net Profit / Loss ──
  if (y + 50 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

  doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(COLORS.primary);
  y += 14;

  const netProfit = d.netProfit != null ? d.netProfit : (d.totalIncome || 0) - (d.totalExpenses || 0);
  const isProfit = netProfit >= 0;
  const netLabel = isProfit ? 'NET PROFIT' : 'NET LOSS';
  const netColor = isProfit ? COLORS.green : COLORS.red;

  doc.font('Helvetica-Bold').fontSize(14).fillColor(netColor);
  doc.text(netLabel, MARGIN + 10, y, { width: CONTENT_WIDTH - 140 });
  doc.text(formatCurrency(Math.abs(netProfit)), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });

  doc.end();
  return doc;
}

// ── Tax Summary PDF ─────────────────────────────────────────────────

/**
 * Generate a Schedule C tax summary PDF.
 * @param {object} data — { year, totalIncome, expenses: [{category, schedule_c_line, amount}], totalExpenses, netProfit }
 * @param {object} settings — business settings
 * @returns {PDFDocument}
 */
function generateTaxSummary(data, settings) {
  const doc = new PDFDocument({ size: 'Letter', margin: MARGIN });

  const s = settings || {};
  const d = data || {};

  let y = MARGIN;

  // ── Header ──
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.primary);
  doc.text(s.business_name || 'Your Business', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 24;

  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.text);
  doc.text('Schedule C Summary', MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 28;

  doc.font('Helvetica').fontSize(12).fillColor(COLORS.secondary);
  doc.text(`Tax Year ${d.year || new Date().getFullYear()}`, MARGIN, y, {
    width: CONTENT_WIDTH,
    align: 'center'
  });
  y += 14;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(COLORS.primary);
  y += 24;

  // ── Income Section ──
  doc.rect(MARGIN, y, CONTENT_WIDTH, 28).fill(COLORS.lightBg);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text);
  doc.text('INCOME', MARGIN + 10, y + 7);
  y += 36;

  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text);
  doc.text('Gross Receipts (Line 1)', MARGIN + 20, y, {
    width: CONTENT_WIDTH - 140
  });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
  doc.text(formatCurrency(d.totalIncome), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });
  y += 30;

  // ── Expenses by Schedule C Line ──
  doc.rect(MARGIN, y, CONTENT_WIDTH, 28).fill(COLORS.lightBg);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text);
  doc.text('EXPENSES', MARGIN + 10, y + 7);
  y += 36;

  // Group expenses by schedule_c_line
  const expensesByLine = {};
  for (const exp of (d.expenses || [])) {
    const line = exp.schedule_c_line || 'Other';
    if (!expensesByLine[line]) {
      expensesByLine[line] = { categories: [], total: 0 };
    }
    expensesByLine[line].categories.push(exp);
    expensesByLine[line].total += (exp.amount || 0);
  }

  // Sort lines by their line number for logical ordering
  const sortedLines = Object.keys(expensesByLine).sort((a, b) => {
    const numA = parseInt((a.match(/\d+/) || ['999'])[0], 10);
    const numB = parseInt((b.match(/\d+/) || ['999'])[0], 10);
    return numA - numB;
  });

  // Table header
  const lineColW = 90;
  const descColW = CONTENT_WIDTH - lineColW - 110;
  const amtColW = 110;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 24).fill(COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
  doc.text('Line', MARGIN + 6, y + 7, { width: lineColW - 10 });
  doc.text('Description', MARGIN + lineColW + 6, y + 7, { width: descColW - 10 });
  doc.text('Amount', MARGIN + lineColW + descColW + 6, y + 7, { width: amtColW - 10, align: 'right' });
  y += 24;

  let rowIdx = 0;
  for (const line of sortedLines) {
    const group = expensesByLine[line];

    if (group.categories.length === 1) {
      // Single category for this line — one row
      if (y + 22 > PAGE_HEIGHT - MARGIN - 30) { doc.addPage(); y = MARGIN; }

      if (rowIdx % 2 === 0) {
        doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(COLORS.lightBg);
        doc.fillColor(COLORS.text);
      }

      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.secondary);
      doc.text(line, MARGIN + 6, y + 6, { width: lineColW - 10 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
      doc.text(group.categories[0].category, MARGIN + lineColW + 6, y + 6, { width: descColW - 10 });
      doc.text(formatCurrency(group.total), MARGIN + lineColW + descColW + 6, y + 6, {
        width: amtColW - 10,
        align: 'right'
      });
      y += 22;
      rowIdx++;
    } else {
      // Multiple categories share this line — group header + sub-items
      if (y + 22 + group.categories.length * 20 > PAGE_HEIGHT - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
      }

      // Line header row
      if (rowIdx % 2 === 0) {
        doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(COLORS.lightBg);
        doc.fillColor(COLORS.text);
      }

      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.secondary);
      doc.text(line, MARGIN + 6, y + 6, { width: lineColW - 10 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text);
      doc.text('(combined)', MARGIN + lineColW + 6, y + 6, { width: descColW - 10 });
      doc.text(formatCurrency(group.total), MARGIN + lineColW + descColW + 6, y + 6, {
        width: amtColW - 10,
        align: 'right'
      });
      y += 22;
      rowIdx++;

      // Sub-items
      for (const cat of group.categories) {
        if (y + 20 > PAGE_HEIGHT - MARGIN - 30) { doc.addPage(); y = MARGIN; }

        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
        doc.text('', MARGIN + 6, y + 5, { width: lineColW - 10 });
        doc.fillColor(COLORS.secondary);
        doc.text(`  ${cat.category}`, MARGIN + lineColW + 6, y + 5, { width: descColW - 10 });
        doc.text(formatCurrency(cat.amount), MARGIN + lineColW + descColW + 6, y + 5, {
          width: amtColW - 10,
          align: 'right'
        });
        y += 20;
      }
    }
  }

  // Total Expenses
  drawHorizontalRule(doc, y);
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text);
  doc.text('Total Expenses', MARGIN + 20, y, { width: CONTENT_WIDTH - 140 });
  doc.text(formatCurrency(d.totalExpenses), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });
  y += 30;

  // ── Net Profit / Loss ──
  if (y + 50 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

  doc.rect(MARGIN, y, CONTENT_WIDTH, 3).fill(COLORS.primary);
  y += 14;

  const netProfit = d.netProfit != null ? d.netProfit : (d.totalIncome || 0) - (d.totalExpenses || 0);
  const isProfit = netProfit >= 0;
  const netColor = isProfit ? COLORS.green : COLORS.red;

  doc.font('Helvetica-Bold').fontSize(14).fillColor(netColor);
  doc.text('Net Profit or Loss (Line 31)', MARGIN + 10, y, {
    width: CONTENT_WIDTH - 140
  });
  doc.text(formatCurrency(netProfit), PAGE_WIDTH - MARGIN - 110, y, {
    width: 100,
    align: 'right'
  });
  y += 30;

  // ── Disclaimer ──
  if (y + 40 > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }

  drawHorizontalRule(doc, y);
  y += 10;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  doc.text(
    'This summary is generated for reference purposes only. Consult a qualified tax professional before filing. ' +
    'Categories are mapped to Schedule C lines based on common conventions and may not reflect your specific tax situation.',
    MARGIN, y, { width: CONTENT_WIDTH, align: 'center' }
  );

  doc.end();
  return doc;
}

// ── Exports ─────────────────────────────────────────────────────────
module.exports = { generateInvoice, generatePnL, generateTaxSummary };
