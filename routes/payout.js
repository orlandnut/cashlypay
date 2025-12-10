const express = require("express");
const Joi = require("joi");
const payoutStore = require("../util/payout-store");
const { initiatePayout } = require("../util/payout-service");

const router = express.Router();

const beneficiarySchema = Joi.object({
  customerId: Joi.string().allow("", null),
  displayName: Joi.string().trim().required(),
  rail: Joi.string().valid("ACH", "WIRE", "CASH_APP", "WALLET").required(),
  details: Joi.object().required(),
});

const payoutSchema = Joi.object({
  beneficiaryId: Joi.string().required(),
  amount: Joi.number().integer().positive().required(),
  currency: Joi.string().length(3).uppercase().required(),
  preferredRail: Joi.string().valid("ACH", "WIRE", "CASH_APP", "WALLET"),
  idempotencyKey: Joi.string().min(10).max(64).optional(),
  metadata: Joi.object().optional(),
});

router.get("/beneficiaries", (req, res) => {
  const beneficiaries = payoutStore.listBeneficiaries(req.query.customerId);
  res.json({ beneficiaries });
});

router.post("/beneficiaries", (req, res, next) => {
  const payload = { ...req.body };
  if (typeof payload.details === "string") {
    try {
      payload.details = JSON.parse(payload.details);
    } catch (parseError) {
      payload.details = {};
    }
  }
  const { error, value } = beneficiarySchema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const err = new Error("Invalid beneficiary payload");
    err.status = 400;
    err.errors = error.details.map((detail) => detail.message);
    return next(err);
  }
  try {
    const beneficiary = payoutStore.createBeneficiary(value);
    res.status(201).json({ beneficiary });
  } catch (creationError) {
    next(creationError);
  }
});

router.get("/console", (req, res) => {
  const beneficiaries = payoutStore.listBeneficiaries();
  const payouts = payoutStore.listPayouts();
  const completedAmount = payouts
    .filter((payout) => payout.status === "completed")
    .reduce((sum, payout) => sum + payout.amount, 0);
  const pendingAmount = payouts
    .filter(
      (payout) => payout.status === "pending" || payout.status === "processing",
    )
    .reduce((sum, payout) => sum + payout.amount, 0);
  res.render("payouts-console", {
    beneficiaries,
    payouts,
    balance: completedAmount,
    pendingAmount,
  });
});

router.get("/", (req, res) => {
  const payouts = payoutStore.listPayouts();
  res.json({ payouts });
});

router.get("/:payoutId", (req, res, next) => {
  try {
    const payout = payoutStore.getPayoutById(req.params.payoutId);
    if (!payout) {
      const err = new Error("Payout not found");
      err.status = 404;
      throw err;
    }
    res.json({ payout });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  const payload = { ...req.body };
  if (typeof payload.metadata === "string" && payload.metadata.trim().length) {
    try {
      payload.metadata = JSON.parse(payload.metadata);
    } catch (parseError) {
      payload.metadata = undefined;
    }
  }
  const { error, value } = payoutSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const err = new Error("Invalid payout payload");
    err.status = 400;
    err.errors = error.details.map((detail) => detail.message);
    return next(err);
  }
  try {
    const payout = await initiatePayout(value);
    res.status(202).json({ payout });
  } catch (serviceError) {
    next(serviceError);
  }
});

module.exports = router;
