const express = require("express");
const Joi = require("joi");
const catalogStore = require("../util/catalog-store");
const serviceStore = require("../util/service-store");

const router = express.Router();

const componentSchema = Joi.object({
  label: Joi.string().trim().optional().allow(""),
  type: Joi.string().valid("LABOR", "MATERIAL", "BUNDLE").default("LABOR"),
  amount: Joi.number().integer().min(0).default(0),
  quantity: Joi.number().precision(2).optional(),
  unit: Joi.string().allow("", null),
  linkedServiceId: Joi.string().allow("", null),
});

const servicePayloadSchema = Joi.object({
  name: Joi.string().trim().min(3).required(),
  description: Joi.string().allow("", null),
  category: Joi.string().trim().allow("", null),
  basePrice: Joi.number().integer().min(0).required(),
  currency: Joi.string().length(3).uppercase().default("USD"),
  allowCard: Joi.boolean().truthy("true", "1", "on").default(true),
  allowBank: Joi.boolean().truthy("true", "1", "on").default(false),
  allowGiftCard: Joi.boolean().truthy("true", "1", "on").default(true),
  allowCashApp: Joi.boolean().truthy("true", "1", "on").default(false),
  paymentSourcePreference: Joi.string()
    .valid("AUTO", "CARD_ON_FILE", "BANK_ON_FILE", "NONE")
    .default("AUTO"),
  notes: Joi.string().allow("", null),
  actor: Joi.string().allow("", null).default("ops@cashly"),
  components: Joi.array().items(componentSchema),
});

const versionPayloadSchema = servicePayloadSchema.append({
  effectiveFrom: Joi.string().allow("", null),
});

const normalizeComponentsFromBody = (body) => {
  const labels = Array.isArray(body.componentLabel)
    ? body.componentLabel
    : body.componentLabel
      ? [body.componentLabel]
      : [];
  const types = Array.isArray(body.componentType)
    ? body.componentType
    : body.componentType
      ? [body.componentType]
      : [];
  const amounts = Array.isArray(body.componentAmount)
    ? body.componentAmount
    : body.componentAmount
      ? [body.componentAmount]
      : [];
  const quantities = Array.isArray(body.componentQuantity)
    ? body.componentQuantity
    : body.componentQuantity
      ? [body.componentQuantity]
      : [];
  const units = Array.isArray(body.componentUnit)
    ? body.componentUnit
    : body.componentUnit
      ? [body.componentUnit]
      : [];
  const linkedServices = Array.isArray(body.componentLinkedServiceId)
    ? body.componentLinkedServiceId
    : body.componentLinkedServiceId
      ? [body.componentLinkedServiceId]
      : [];

  const maxLength = Math.max(
    labels.length,
    types.length,
    amounts.length,
    quantities.length,
    units.length,
    linkedServices.length,
  );
  const components = [];
  for (let i = 0; i < maxLength; i += 1) {
    components.push({
      label: labels[i] || "",
      type: types[i] || "LABOR",
      amount: amounts[i] || 0,
      quantity: quantities[i] || "",
      unit: units[i] || "",
      linkedServiceId: linkedServices[i] || "",
    });
  }
  return components;
};

router.get("/", (req, res) => {
  const catalog = catalogStore.listCatalog();
  res.render("catalog/index", {
    catalog,
    services: serviceStore.list(),
  });
});

router.get("/new", (req, res) => {
  res.render("catalog/new", {
    services: serviceStore.list(),
    errors: [],
    form: {
      currency: "USD",
      allowCard: true,
      allowGiftCard: true,
    },
  });
});

router.post("/", (req, res, next) => {
  const rawPayload = {
    ...req.body,
    components: normalizeComponentsFromBody(req.body),
  };

  const { error, value } = servicePayloadSchema.validate(rawPayload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const errors = error.details.map((detail) => detail.message);
    return res.status(400).render("catalog/new", {
      services: serviceStore.list(),
      errors,
      form: rawPayload,
    });
  }

  try {
    const service = catalogStore.createServiceDraft(value);
    const latestVersion = service.versions[0];
    catalogStore.submitVersion(latestVersion.id, value.actor);
    catalogStore.approveVersion(latestVersion.id, value.actor);
    return res.redirect(`/catalog/${service.id}`);
  } catch (err) {
    return next(err);
  }
});

router.get("/:serviceId", (req, res, next) => {
  try {
    const service = catalogStore.getServiceWithVersions(req.params.serviceId);
    if (!service) {
      const error = new Error("Service not found");
      error.status = 404;
      throw error;
    }
    res.render("catalog/detail", {
      service,
      services: serviceStore.list(),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:serviceId/versions", (req, res, next) => {
  const components = normalizeComponentsFromBody(req.body);
  const rawPayload = {
    ...req.body,
    components,
  };
  const { error, value } = versionPayloadSchema.validate(rawPayload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    return res.status(400).redirect(`/catalog/${req.params.serviceId}`);
  }
  try {
    catalogStore.createVersion(req.params.serviceId, value);
    return res.redirect(`/catalog/${req.params.serviceId}`);
  } catch (error) {
    return next(error);
  }
});

router.post("/:serviceId/versions/:versionId/submit", (req, res, next) => {
  try {
    catalogStore.submitVersion(req.params.versionId, req.body.actor || "ops");
    return res.redirect(`/catalog/${req.params.serviceId}`);
  } catch (error) {
    return next(error);
  }
});

router.post("/:serviceId/versions/:versionId/approve", (req, res, next) => {
  try {
    catalogStore.approveVersion(
      req.params.versionId,
      req.body.actor || "finance",
    );
    return res.redirect(`/catalog/${req.params.serviceId}`);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
