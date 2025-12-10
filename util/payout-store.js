const crypto = require("crypto");
const db = require("./db");

const parseJSON = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const mapBeneficiary = (row) =>
  row && {
    id: row.id,
    customerId: row.customer_id,
    displayName: row.display_name,
    rail: row.rail,
    details: parseJSON(row.details),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const mapPayout = (row) =>
  row && {
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    amount: row.amount,
    currency: row.currency,
    rail: row.rail,
    status: row.status,
    providerReference: row.provider_reference,
    errorMessage: row.error_message,
    idempotencyKey: row.idempotency_key,
    metadata: parseJSON(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const createBeneficiary = ({ customerId, displayName, rail, details }) => {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO payout_beneficiaries
      (id, customer_id, display_name, rail, details, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    customerId || null,
    displayName,
    rail,
    JSON.stringify(details),
    timestamp,
    timestamp,
  );
  return getBeneficiaryById(id);
};

const getBeneficiaryById = (id) => {
  const row = db
    .prepare(`SELECT * FROM payout_beneficiaries WHERE id = ?`)
    .get(id);
  return mapBeneficiary(row);
};

const listBeneficiaries = (customerId) => {
  const rows = customerId
    ? db
        .prepare(
          `SELECT * FROM payout_beneficiaries WHERE customer_id = ? ORDER BY created_at DESC`,
        )
        .all(customerId)
    : db
        .prepare(`SELECT * FROM payout_beneficiaries ORDER BY created_at DESC`)
        .all();
  return rows.map(mapBeneficiary);
};

const createPayout = ({
  beneficiaryId,
  amount,
  currency,
  rail,
  idempotencyKey,
  metadata,
}) => {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO payouts
      (id, beneficiary_id, amount, currency, rail, status, idempotency_key, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    id,
    beneficiaryId,
    amount,
    currency,
    rail,
    idempotencyKey,
    metadata ? JSON.stringify(metadata) : null,
    timestamp,
    timestamp,
  );
  return getPayoutById(id);
};

const getPayoutById = (id) => {
  const row = db.prepare(`SELECT * FROM payouts WHERE id = ?`).get(id);
  return mapPayout(row);
};

const getPayoutByIdempotencyKey = (key) => {
  const row = db
    .prepare(`SELECT * FROM payouts WHERE idempotency_key = ?`)
    .get(key);
  return mapPayout(row);
};

const listPayouts = () => {
  const rows = db
    .prepare(`SELECT * FROM payouts ORDER BY created_at DESC LIMIT 100`)
    .all();
  return rows.map(mapPayout);
};

const updatePayoutStatus = (
  id,
  { status, providerReference, errorMessage },
) => {
  db.prepare(
    `UPDATE payouts
     SET status = ?, provider_reference = COALESCE(?, provider_reference),
         error_message = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    providerReference || null,
    errorMessage || null,
    new Date().toISOString(),
    id,
  );
  return getPayoutById(id);
};

module.exports = {
  createBeneficiary,
  getBeneficiaryById,
  listBeneficiaries,
  createPayout,
  getPayoutById,
  getPayoutByIdempotencyKey,
  listPayouts,
  updatePayoutStatus,
};
