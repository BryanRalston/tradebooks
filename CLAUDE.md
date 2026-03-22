# TradeBooks

Simple bookkeeping web app for a general contractor. Track expenses, income, jobs, invoices, and generate tax-ready reports.

## Tech Stack
- **Backend**: Node.js + Express (port 3143)
- **Database**: SQLite via better-sqlite3 (`tradebooks.db`)
- **PDF**: pdfkit for invoices and reports
- **Frontend**: Vanilla JS SPA, mobile-first, no build tools
- **Uploads**: multer for receipt photos → `uploads/receipts/`

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Express server, all API routes |
| `db.js` | SQLite schema, migrations, seed data, query helpers |
| `pdf.js` | Invoice and report PDF generation |
| `seed.js` | Generate sample test data |
| `public/index.html` | SPA shell with responsive nav |
| `public/app.js` | 16 IIFE modules — full frontend |
| `public/styles.css` | "Clean Ledger" design system |

## Running
```bash
cd C:\Cortex\tradebooks
npm install
node server.js          # http://localhost:3143
node seed.js            # Optional: generate sample data
```

## Design System: "Clean Ledger"
- Light professional theme (slate backgrounds, white cards)
- Brand color: Blue 600 (#2563EB)
- Green = income/positive, Red = expense/negative
- Mobile: bottom tab bar. Desktop: sidebar nav.
- System fonts, monospace for financial numbers

## API Prefix
All endpoints at `/api/` — settings, categories, clients, jobs, expenses, income, invoices, reports, dashboard.

## Database
- SQLite with WAL mode, foreign keys enabled
- 7 tables: settings, categories, clients, jobs, expenses, income, invoices, invoice_items
- Tax categories pre-seeded aligned to Schedule C
