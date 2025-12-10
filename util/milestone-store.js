const crypto = require("crypto");
const db = require("./db");

const mapMilestone = (row) => ({
  id: row.id,
  invoiceId: row.invoice_id,
  label: row.label,
  dueDate: row.due_date,
  amount: row.amount,
  currency: row.currency,
  paymentSource: row.payment_source,
  allowCard: !!row.allow_card,
  allowBank: !!row.allow_bank,
  allowGiftCard: !!row.allow_gift_card,
  allowCashApp: !!row.allow_cash_app,
  status: row.status,
  createdAt: row.created_at,
});

const addMilestones = (invoiceId, milestones = []) => {
  if (!milestones.length) return [];
  const insert = db.prepare(
    `INSERT INTO invoice_milestones (id, invoice_id, label, due_date, amount, currency, payment_source, allow_card, allow_bank, allow_gift_card, allow_cash_app, status, created_at)
     VALUES (@id, @invoice_id, @label, @due_date, @amount, @currency, @payment_source, @allow_card, @allow_bank, @allow_gift_card, @allow_cash_app, @status, @created_at)`,
  );
  const rows = milestones.map((milestone) => ({
    id: crypto.randomUUID(),
    invoice_id: invoiceId,
    label: milestone.label,
    due_date: milestone.dueDate || null,
    amount: milestone.amount,
    currency: milestone.currency,
    payment_source: milestone.paymentSource || "AUTO",
    allow_card: milestone.allowCard ? 1 : 0,
    allow_bank: milestone.allowBank ? 1 : 0,
    allow_gift_card: milestone.allowGiftCard ? 1 : 0,
    allow_cash_app: milestone.allowCashApp ? 1 : 0,
    status: milestone.status || "scheduled",
    created_at: new Date().toISOString(),
  }));
  const insertMany = db.transaction((payloads) => {
    payloads.forEach((payload) => insert.run(payload));
  });
  insertMany(rows);
  return rows.map(mapMilestone);
};

const listByInvoiceIds = (invoiceIds = []) => {
  if (!invoiceIds.length) return {};
  const placeholders = invoiceIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM invoice_milestones WHERE invoice_id IN (${placeholders}) ORDER BY due_date ASC`,
    )
    .all(...invoiceIds);
  return rows.reduce((acc, row) => {
    if (!acc[row.invoice_id]) {
      acc[row.invoice_id] = [];
    }
    acc[row.invoice_id].push(mapMilestone(row));
    return acc;
  }, {});
};

const listAll = () => {
  return db
    .prepare(
      `SELECT * FROM invoice_milestones ORDER BY created_at DESC LIMIT 100`,
    )
    .all()
    .map(mapMilestone);
};

const getByInvoiceId = (invoiceId) => {
  return db
    .prepare(
      `SELECT * FROM invoice_milestones WHERE invoice_id = ? ORDER BY due_date ASC`,
    )
    .all(invoiceId)
    .map(mapMilestone);
};

const metrics = () => {
  const totals = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM invoice_milestones GROUP BY status`,
    )
    .all();
  const amountRow = db
    .prepare(`SELECT SUM(amount) as total_amount FROM invoice_milestones`)
    .get();
  return {
    totals,
    totalAmount: amountRow?.total_amount || 0,
  };
};

const listUpcoming = (limit = 5) => {
  return db
    .prepare(
      `SELECT * FROM invoice_milestones
       WHERE status = 'scheduled' AND due_date IS NOT NULL
       ORDER BY due_date ASC
       LIMIT ?`,
    )
    .all(limit)
    .map(mapMilestone);
};

module.exports = {
  addMilestones,
  listByInvoiceIds,
  getByInvoiceId,
  listAll,
  metrics,
  listUpcoming,
};
