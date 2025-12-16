const db = require("./db");

const hasActorColumn = (() => {
  try {
    const columns = db.prepare("PRAGMA table_info(activity_log)").all();
    return columns.some((entry) => entry.name === "actor");
  } catch (error) {
    return false;
  }
})();

const insertStmt = hasActorColumn
  ? db.prepare(
      "INSERT INTO activity_log (id, invoice_id, type, payload, actor, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    )
  : db.prepare(
      "INSERT INTO activity_log (id, invoice_id, type, payload, timestamp) VALUES (?, ?, ?, ?, ?)",
    );

const runInsert = (args, event) => {
  try {
    insertStmt.run(...args);
  } catch (error) {
    if (error && error.code === "SQLITE_READONLY") {
      // eslint-disable-next-line no-console
      console.warn(
        `[ActivityLog] Unable to persist event ${event.type || "unknown"}: ${
          error.message
        }`,
      );
      return;
    }
    throw error;
  }
};

const addEvent = (event) => {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (hasActorColumn) {
    runInsert(
      [
        id,
        event.invoiceId || null,
        event.type,
        JSON.stringify(event.payload || null),
        event.actor || null,
        new Date().toISOString(),
      ],
      event,
    );
  } else {
    runInsert(
      [
        id,
        event.invoiceId || null,
        event.type,
        JSON.stringify(event.payload || null),
        new Date().toISOString(),
      ],
      event,
    );
  }
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
      actor: row.actor,
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
      actor: row.actor,
      timestamp: row.timestamp,
    }));
};

const listByTypePrefix = (prefix, limit = 20) => {
  const stmt = db.prepare(
    "SELECT * FROM activity_log WHERE type LIKE ? ORDER BY timestamp DESC LIMIT ?",
  );
  return stmt
    .all(`${prefix}%`, limit)
    .map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      type: row.type,
      payload: row.payload ? JSON.parse(row.payload) : null,
      actor: row.actor,
      timestamp: row.timestamp,
    }));
};

module.exports = {
  addEvent,
  listByInvoice,
  listAll,
  listByTypePrefix,
};
