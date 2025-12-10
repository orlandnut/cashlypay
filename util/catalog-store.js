const crypto = require("crypto");
const db = require("./db");
const defaultServices = require("../config/services").services;

const nowIso = () => new Date().toISOString();

const mapComponent = (row) => ({
  id: row.id,
  type: row.component_type,
  label: row.label,
  amount: row.amount,
  quantity: row.quantity,
  unit: row.unit,
  linkedServiceId: row.linked_service_id,
});

const listComponents = (versionId) => {
  return db
    .prepare(
      `
    SELECT * FROM service_components
    WHERE version_id = ?
    ORDER BY created_at ASC
  `,
    )
    .all(versionId)
    .map(mapComponent);
};

const mapVersion = (row) =>
  row && {
    id: row.id,
    serviceId: row.service_id,
    version: row.version,
    basePrice: row.base_price,
    currency: row.currency,
    allowCard: !!row.allow_card,
    allowBank: !!row.allow_bank,
    allowGiftCard: !!row.allow_gift_card,
    allowCashApp: !!row.allow_cash_app,
    paymentSourcePreference: row.payment_source_preference || "AUTO",
    status: row.status,
    effectiveFrom: row.effective_from,
    notes: row.notes,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    components: listComponents(row.id),
  };

const mapServiceRow = (row) =>
  row && {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const recordAudit = ({ serviceId, versionId, action, actor, payload }) => {
  db.prepare(
    `INSERT INTO service_audit_log (id, service_id, version_id, actor, action, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    serviceId || null,
    versionId || null,
    actor || "system",
    action,
    payload ? JSON.stringify(payload) : null,
    nowIso(),
  );
};

const listAudit = (serviceId) => {
  return db
    .prepare(
      `SELECT * FROM service_audit_log WHERE service_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(serviceId)
    .map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor,
      payload: row.payload ? JSON.parse(row.payload) : null,
      createdAt: row.created_at,
    }));
};

const publishVersionIntoServicesTable = (service, version) => {
  const breakdown = JSON.stringify(
    (version.components || []).map((component) => ({
      type: component.type,
      label: component.label,
      amount: component.amount,
      quantity: component.quantity,
      unit: component.unit,
      linkedServiceId: component.linkedServiceId,
    })),
  );
  db.prepare(
    `
    INSERT INTO services (id, name, price_amount, currency, description, breakdown, category, allow_card, allow_bank, allow_gift_card, allow_cash_app, updated_at)
    VALUES (@id, @name, @price_amount, @currency, @description, @breakdown, @category, @allow_card, @allow_bank, @allow_gift_card, @allow_cash_app, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      price_amount = excluded.price_amount,
      currency = excluded.currency,
      description = excluded.description,
      breakdown = excluded.breakdown,
      category = excluded.category,
      allow_card = excluded.allow_card,
      allow_bank = excluded.allow_bank,
      allow_gift_card = excluded.allow_gift_card,
      allow_cash_app = excluded.allow_cash_app,
      updated_at = excluded.updated_at
  `,
  ).run({
    id: service.id,
    name: service.name,
    price_amount: version.basePrice,
    currency: version.currency,
    description: service.description,
    breakdown,
    category: service.category,
    allow_card: version.allowCard ? 1 : 0,
    allow_bank: version.allowBank ? 1 : 0,
    allow_gift_card: version.allowGiftCard ? 1 : 0,
    allow_cash_app: version.allowCashApp ? 1 : 0,
    updated_at: nowIso(),
  });
};

const getServiceWithVersions = (serviceId) => {
  const serviceRow = db
    .prepare("SELECT * FROM service_catalog WHERE id = ?")
    .get(serviceId);
  if (!serviceRow) return null;
  const versions = db
    .prepare(
      `
      SELECT * FROM service_versions
      WHERE service_id = ?
      ORDER BY version DESC
    `,
    )
    .all(serviceId)
    .map(mapVersion);
  return {
    ...mapServiceRow(serviceRow),
    versions,
    auditLog: listAudit(serviceId),
  };
};

const listCatalog = () => {
  const services = db
    .prepare(
      `
    SELECT sc.*, (
      SELECT version FROM service_versions
      WHERE service_id = sc.id AND status = 'published'
      ORDER BY version DESC LIMIT 1
    ) AS published_version,
    (
      SELECT status FROM service_versions
      WHERE service_id = sc.id
      ORDER BY updated_at DESC LIMIT 1
    ) AS latest_version_status
    FROM service_catalog sc
    ORDER BY sc.name ASC
  `,
    )
    .all();

  return services.map((row) => ({
    ...mapServiceRow(row),
    publishedVersion: row.published_version,
    latestVersionStatus: row.latest_version_status || "draft",
  }));
};

const createComponents = (versionId, components = []) => {
  if (!components.length) return;
  const insert = db.prepare(
    `INSERT INTO service_components (id, version_id, component_type, label, amount, quantity, unit, linked_service_id, created_at)
     VALUES (@id, @version_id, @component_type, @label, @amount, @quantity, @unit, @linked_service_id, @created_at)`,
  );
  const insertMany = db.transaction((payloads) => {
    payloads.forEach((component) => insert.run(component));
  });

  const records = components
    .filter((component) => component.label)
    .map((component) => ({
      id: crypto.randomUUID(),
      version_id: versionId,
      component_type: component.type || "LABOR",
      label: component.label,
      amount: Number.parseInt(component.amount, 10) || 0,
      quantity: component.quantity ? Number(component.quantity) : null,
      unit: component.unit || null,
      linked_service_id: component.linkedServiceId || null,
      created_at: nowIso(),
    }));
  insertMany(records);
};

const createServiceDraft = (input) => {
  const id = input.id || crypto.randomUUID();
  const timestamp = nowIso();
  const servicePayload = {
    id,
    name: input.name,
    description: input.description || null,
    category: input.category || null,
    status: "draft",
    created_by: input.actor || "ops",
    approved_by: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const versionId = crypto.randomUUID();
  const versionPayload = {
    id: versionId,
    service_id: id,
    version: 1,
    base_price: input.basePrice,
    currency: input.currency || "USD",
    allow_card: input.allowCard ? 1 : 0,
    allow_bank: input.allowBank ? 1 : 0,
    allow_gift_card: input.allowGiftCard ? 1 : 0,
    allow_cash_app: input.allowCashApp ? 1 : 0,
    payment_source_preference: input.paymentSourcePreference || "AUTO",
    status: "draft",
    effective_from: input.effectiveFrom || null,
    notes: input.notes || null,
    created_by: input.actor || "ops",
    submitted_by: null,
    approved_by: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO service_catalog
        (id, name, description, category, status, created_by, approved_by, created_at, updated_at)
       VALUES (@id, @name, @description, @category, @status, @created_by, @approved_by, @created_at, @updated_at)`,
    ).run(servicePayload);

    db.prepare(
      `INSERT INTO service_versions
        (id, service_id, version, base_price, currency, allow_card, allow_bank, allow_gift_card, allow_cash_app, payment_source_preference, status, effective_from, notes, created_by, submitted_by, approved_by, created_at, updated_at)
       VALUES (@id, @service_id, @version, @base_price, @currency, @allow_card, @allow_bank, @allow_gift_card, @allow_cash_app, @payment_source_preference, @status, @effective_from, @notes, @created_by, @submitted_by, @approved_by, @created_at, @updated_at)`,
    ).run(versionPayload);

    createComponents(versionId, input.components || []);

    recordAudit({
      action: "SERVICE_CREATED",
      actor: input.actor || "ops",
      serviceId: id,
      versionId,
      payload: {
        name: input.name,
        basePrice: input.basePrice,
      },
    });
  });

  transaction();
  return getServiceWithVersions(id);
};

const getVersionById = (versionId) => {
  const row = db
    .prepare("SELECT * FROM service_versions WHERE id = ?")
    .get(versionId);
  return mapVersion(row);
};

const nextVersionNumber = (serviceId) => {
  const { max_version: maxVersion } = db
    .prepare(
      `SELECT MAX(version) as max_version FROM service_versions WHERE service_id = ?`,
    )
    .get(serviceId);
  return (maxVersion || 0) + 1;
};

const createVersion = (serviceId, input) => {
  const service = mapServiceRow(
    db.prepare("SELECT * FROM service_catalog WHERE id = ?").get(serviceId),
  );
  if (!service) {
    throw new Error("Service not found");
  }
  const versionId = crypto.randomUUID();
  const timestamp = nowIso();
  const versionPayload = {
    id: versionId,
    service_id: serviceId,
    version: nextVersionNumber(serviceId),
    base_price: input.basePrice,
    currency: input.currency || "USD",
    allow_card: input.allowCard ? 1 : 0,
    allow_bank: input.allowBank ? 1 : 0,
    allow_gift_card: input.allowGiftCard ? 1 : 0,
    allow_cash_app: input.allowCashApp ? 1 : 0,
    payment_source_preference: input.paymentSourcePreference || "AUTO",
    status: "draft",
    effective_from: input.effectiveFrom || null,
    notes: input.notes || null,
    created_by: input.actor || "ops",
    submitted_by: null,
    approved_by: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO service_versions
       (id, service_id, version, base_price, currency, allow_card, allow_bank, allow_gift_card, allow_cash_app, payment_source_preference, status, effective_from, notes, created_by, submitted_by, approved_by, created_at, updated_at)
       VALUES (@id, @service_id, @version, @base_price, @currency, @allow_card, @allow_bank, @allow_gift_card, @allow_cash_app, @payment_source_preference, @status, @effective_from, @notes, @created_by, @submitted_by, @approved_by, @created_at, @updated_at)`,
    ).run(versionPayload);

    createComponents(versionId, input.components || []);
    recordAudit({
      action: "VERSION_CREATED",
      actor: input.actor || "ops",
      serviceId,
      versionId,
      payload: {
        version: versionPayload.version,
        basePrice: input.basePrice,
      },
    });
  });

  txn();
  return getVersionById(versionId);
};

const submitVersion = (versionId, actor) => {
  const version = getVersionById(versionId);
  if (!version) throw new Error("Version not found");
  db.prepare(
    `UPDATE service_versions
     SET status = 'pending_approval', submitted_by = ?, updated_at = ?
     WHERE id = ?`,
  ).run(actor || "ops", nowIso(), versionId);
  recordAudit({
    action: "VERSION_SUBMITTED",
    actor,
    serviceId: version.serviceId,
    versionId,
    payload: { version: version.version },
  });
  return getVersionById(versionId);
};

const rejectVersion = (versionId, actor, notes) => {
  const version = getVersionById(versionId);
  if (!version) throw new Error("Version not found");
  db.prepare(
    `UPDATE service_versions
     SET status = 'rejected', updated_at = ?, notes = ?
     WHERE id = ?`,
  ).run(nowIso(), notes || version.notes, versionId);
  recordAudit({
    action: "VERSION_REJECTED",
    actor,
    serviceId: version.serviceId,
    versionId,
    payload: { notes },
  });
  return getVersionById(versionId);
};

const approveVersion = (versionId, actor) => {
  const version = getVersionById(versionId);
  if (!version) throw new Error("Version not found");
  const service = mapServiceRow(
    db
      .prepare("SELECT * FROM service_catalog WHERE id = ?")
      .get(version.serviceId),
  );
  if (!service) throw new Error("Service not found");

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE service_versions
       SET status = 'published', approved_by = ?, updated_at = ?
       WHERE id = ?`,
    ).run(actor || "finance", nowIso(), versionId);

    db.prepare(
      `UPDATE service_catalog
       SET status = 'active', approved_by = ?, updated_at = ?
       WHERE id = ?`,
    ).run(actor || "finance", nowIso(), service.id);

    publishVersionIntoServicesTable(service, version);
    recordAudit({
      action: "VERSION_APPROVED",
      actor,
      serviceId: service.id,
      versionId,
      payload: {
        version: version.version,
        basePrice: version.basePrice,
      },
    });
  });

  txn();
  return getVersionById(versionId);
};

const getPublishedVersionComponents = () => {
  return db
    .prepare(
      `
      SELECT sv.service_id, sv.id as version_id
      FROM service_versions sv
      WHERE sv.status = 'published'
    `,
    )
    .all()
    .reduce((acc, row) => {
      acc[row.service_id] = listComponents(row.version_id);
      return acc;
    }, {});
};

const ensureSeeded = () => {
  const count = db
    .prepare("SELECT COUNT(*) as count FROM service_catalog")
    .get().count;
  if (count > 0) {
    return;
  }
  defaultServices.forEach((svc) => {
    const basePrice = svc.priceAmount;
    createServiceDraft({
      id: svc.id,
      name: svc.name,
      description: svc.description,
      category: svc.category,
      basePrice,
      currency: svc.currency || "USD",
      allowCard: svc.paymentMethods?.card !== false,
      allowBank: !!svc.paymentMethods?.bankAccount,
      allowGiftCard: !!svc.paymentMethods?.squareGiftCard,
      allowCashApp: !!svc.paymentMethods?.cashAppPay,
      actor: "system",
      components: [
        {
          type: "LABOR",
          label: svc.name,
          amount: basePrice,
          unit: "each",
          quantity: 1,
        },
      ],
    });
    const draft = db
      .prepare(
        `SELECT id FROM service_versions WHERE service_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(svc.id);
    if (draft?.id) {
      submitVersion(draft.id, "system");
      approveVersion(draft.id, "system");
    }
  });
};

ensureSeeded();

module.exports = {
  listCatalog,
  getServiceWithVersions,
  createServiceDraft,
  createVersion,
  submitVersion,
  approveVersion,
  rejectVersion,
  listAudit,
  getVersionById,
  ensureSeeded,
  getPublishedVersionComponents,
};
