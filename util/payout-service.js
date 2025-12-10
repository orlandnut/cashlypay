const crypto = require("crypto");
const payoutStore = require("./payout-store");
const activityStore = require("./activity-store");

const inFlightPayouts = new Map();

const simulateProviderCall = async (payout) => {
  const providerReference = `PO-${crypto.randomUUID().slice(0, 8)}`;
  payoutStore.updatePayoutStatus(payout.id, {
    status: "processing",
    providerReference,
  });
  activityStore.addEvent({
    invoiceId: null,
    type: "PAYOUT_PROCESSING",
    payload: {
      payoutId: payout.id,
      rail: payout.rail,
      providerReference,
    },
  });

  setTimeout(() => {
    const shouldFail = Math.random() < 0.05;
    if (shouldFail) {
      payoutStore.updatePayoutStatus(payout.id, {
        status: "failed",
        errorMessage: "Provider rejected transfer",
      });
      activityStore.addEvent({
        invoiceId: null,
        type: "PAYOUT_FAILED",
        payload: {
          payoutId: payout.id,
          rail: payout.rail,
        },
      });
    } else {
      payoutStore.updatePayoutStatus(payout.id, {
        status: "completed",
      });
      activityStore.addEvent({
        invoiceId: null,
        type: "PAYOUT_COMPLETED",
        payload: {
          payoutId: payout.id,
          rail: payout.rail,
        },
      });
    }
    inFlightPayouts.delete(payout.id);
  }, 2000);
};

const determineRail = (preferredRail, beneficiary) => {
  if (preferredRail) return preferredRail;
  return beneficiary.rail;
};

const initiatePayout = async ({
  beneficiaryId,
  amount,
  currency,
  idempotencyKey,
  preferredRail,
  metadata,
}) => {
  if (!beneficiaryId || !amount || !currency) {
    throw new Error("Missing payout parameters");
  }
  const existing = idempotencyKey
    ? payoutStore.getPayoutByIdempotencyKey(idempotencyKey)
    : null;
  if (existing) {
    return existing;
  }

  const beneficiary = payoutStore.getBeneficiaryById(beneficiaryId);
  if (!beneficiary) {
    const err = new Error("Beneficiary not found");
    err.status = 404;
    throw err;
  }

  const rail = determineRail(preferredRail, beneficiary);
  const payout = payoutStore.createPayout({
    beneficiaryId,
    amount,
    currency,
    rail,
    idempotencyKey: idempotencyKey || crypto.randomUUID(),
    metadata,
  });

  inFlightPayouts.set(payout.id, payout);
  simulateProviderCall(payout);
  return payout;
};

module.exports = {
  initiatePayout,
  inFlightPayouts,
};
