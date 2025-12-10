const db = require("./db");

const insertStmt = db.prepare(
  "INSERT INTO activity_log (id, invoice_id, type, payload, timestamp) VALUES (?, ?, ?, ?, ?)",
);

const addEvent = (event) => {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  insertStmt.run(
    id,
    event.invoiceId || null,
    event.type,
    JSON.stringify(event.payload || null),
    new Date().toISOString(),
  );
};

const listByInvoice = (invoiceId) => {
  return db
    .prepare(
      "SELECT * FROM activity_log WHERE invoice_id = ? ORDER BY timestamp ASC",
    )
    .all(invoiceId)
    .map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      type: row.type,
      payload: row.payload ? JSON.parse(row.payload) : null,
      timestamp: row.timestamp,
    }));
};

const listAll = () => {
  return db
    .prepare("SELECT * FROM activity_log ORDER BY timestamp ASC")
    .all()
    .map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      type: row.type,
      payload: row.payload ? JSON.parse(row.payload) : null,
      timestamp: row.timestamp,
    }));
};

module.exports = {
  addEvent,
  listByInvoice,
  listAll,
};
