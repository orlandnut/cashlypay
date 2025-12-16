const crypto = require("crypto");
const {
  giftCardsApi,
  giftCardActivitiesApi,
} = require("./square-client");

const DEFAULT_LIMIT = 30;

const safeCall = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if (error?.result?.errors?.length) {
      const detail = error.result.errors
        .map((item) => item.detail || item.code)
        .join(", ");
      const wrapped = new Error(detail || "Square API request failed");
      wrapped.status = error.statusCode || 400;
      throw wrapped;
    }
    throw error;
  }
};

const normalizeMoney = (money) => ({
  amount: money?.amount || 0,
  currency: money?.currency || "USD",
});

const mapGiftCard = (card) => ({
  id: card.id,
  type: card.type,
  state: card.state,
  gan: card.gan,
  createdAt: card.createdAt,
  balance: normalizeMoney(card.balanceMoney),
  customerIds: card.customerIds || [],
});

const extractActivityAmount = (activity) => {
  const candidate =
    activity.loadActivityDetails?.amountMoney ||
    activity.activateActivityDetails?.amountMoney ||
    activity.adjustIncrementActivityDetails?.amountMoney ||
    activity.adjustDecrementActivityDetails?.amountMoney ||
    activity.redeemActivityDetails?.amountMoney ||
    activity.clearBalanceActivityDetails?.amountMoney;
  return normalizeMoney(candidate);
};

const mapActivity = (activity) => ({
  id: activity.id,
  type: activity.type,
  locationId: activity.locationId,
  createdAt: activity.createdAt,
  giftCardId: activity.giftCardId || activity.giftCardGan,
  balance: normalizeMoney(activity.giftCardBalanceMoney),
  amount: extractActivityAmount(activity),
});

const centsFromAmount = (amount) => {
  if (amount === null || typeof amount === "undefined") return null;
  const numeric = Number.parseFloat(amount);
  if (Number.isNaN(numeric)) return null;
  return Math.round(numeric * 100);
};

async function listGiftCards(options = {}) {
  const {
    type,
    state,
    limit = DEFAULT_LIMIT,
    cursor,
    customerId,
  } = options;
  const { result } = await safeCall(() =>
    giftCardsApi.listGiftCards(type, state, limit, cursor, customerId),
  );
  return {
    cards: (result.giftCards || []).map(mapGiftCard),
    cursor: result.cursor || null,
  };
}

async function listGiftCardActivities(options = {}) {
  const {
    giftCardId,
    type,
    locationId,
    beginTime,
    endTime,
    limit = DEFAULT_LIMIT,
    cursor,
    sortOrder = "DESC",
  } = options;
  const { result } = await safeCall(() =>
    giftCardActivitiesApi.listGiftCardActivities(
      giftCardId,
      type,
      locationId,
      beginTime,
      endTime,
      limit,
      cursor,
      sortOrder,
    ),
  );
  return {
    activities: (result.giftCardActivities || []).map(mapActivity),
    cursor: result.cursor || null,
  };
}

async function issueGiftCard({
  type = "DIGITAL",
  amountCents,
  currency = "USD",
  locationId,
  customerId,
  referenceId,
}) {
  if (!locationId) {
    throw new Error("Location ID is required to issue a gift card");
  }
  const { result } = await safeCall(() =>
    giftCardsApi.createGiftCard({
      idempotencyKey: crypto.randomUUID(),
      locationId,
      giftCard: { type },
    }),
  );

  const card = result?.giftCard;
  if (!card) {
    throw new Error("Gift card creation response did not include a card");
  }

  if (customerId) {
    await safeCall(() =>
      giftCardsApi.linkCustomerToGiftCard(card.id, { customerId }),
    );
  }

  if (amountCents && amountCents > 0) {
    await safeCall(() =>
      giftCardActivitiesApi.createGiftCardActivity({
        idempotencyKey: crypto.randomUUID(),
        giftCardActivity: {
          type: "ACTIVATE",
          locationId,
          giftCardId: card.id,
          activateActivityDetails: {
            amountMoney: {
              amount: amountCents,
              currency,
            },
            referenceId,
          },
        },
      }),
    );
  }

  return mapGiftCard(card);
}

async function loadGiftCardBalance({
  giftCardId,
  amountCents,
  currency = "USD",
  locationId,
  referenceId,
}) {
  if (!giftCardId || !amountCents || amountCents <= 0) {
    throw new Error("Gift card ID and a positive amount are required");
  }
  if (!locationId) {
    throw new Error("Location ID is required");
  }
  await safeCall(() =>
    giftCardActivitiesApi.createGiftCardActivity({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        type: "LOAD",
        locationId,
        giftCardId,
        loadActivityDetails: {
          amountMoney: {
            amount: amountCents,
            currency,
          },
          referenceId,
        },
      },
    }),
  );
}

const buildGiftCardStats = (cards = []) => {
  const totals = cards.reduce(
    (acc, card) => {
      const amount = card.balance?.amount || 0;
      acc.totalBalance += amount;
      if (card.state === "ACTIVE") acc.active += 1;
      if (card.state === "BLOCKED") acc.blocked += 1;
      if (card.state === "DEACTIVATED") acc.deactivated += 1;
      return acc;
    },
    { totalBalance: 0, active: 0, blocked: 0, deactivated: 0 },
  );
  return {
    totalBalance: totals.totalBalance,
    activeCards: totals.active,
    blockedCards: totals.blocked,
    deactivatedCards: totals.deactivated,
    totalIssued: cards.length,
  };
};

const retrieveGiftCard = async (giftCardId) => {
  if (!giftCardId) {
    throw new Error("Gift card id is required");
  }
  const { result } = await safeCall(() =>
    giftCardsApi.retrieveGiftCard(giftCardId),
  );
  return mapGiftCard(result.giftCard);
};

const blockGiftCard = async ({ giftCardId, locationId, reason }) => {
  if (!giftCardId || !locationId) {
    throw new Error("Gift card and location are required");
  }
  await safeCall(() =>
    giftCardActivitiesApi.createGiftCardActivity({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        type: "BLOCK",
        locationId,
        giftCardId,
        blockActivityDetails: {
          reason: reason || "Blocked via dashboard",
        },
      },
    }),
  );
};

const unblockGiftCard = async ({ giftCardId, locationId, reason }) => {
  if (!giftCardId || !locationId) {
    throw new Error("Gift card and location are required");
  }
  await safeCall(() =>
    giftCardActivitiesApi.createGiftCardActivity({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        type: "UNBLOCK",
        locationId,
        giftCardId,
        unblockActivityDetails: {
          reason: reason || "Unblocked via dashboard",
        },
      },
    }),
  );
};

const adjustGiftCardBalance = async ({
  giftCardId,
  amountCents,
  currency = "USD",
  locationId,
  reason,
}) => {
  if (!giftCardId || !locationId) {
    throw new Error("Gift card and location are required");
  }
  if (!amountCents || amountCents === 0) {
    throw new Error("Adjustment amount must be non-zero");
  }
  const isIncrement = amountCents > 0;
  const payloadKey = isIncrement
    ? "adjustIncrementActivityDetails"
    : "adjustDecrementActivityDetails";
  const amount = Math.abs(amountCents);
  await safeCall(() =>
    giftCardActivitiesApi.createGiftCardActivity({
      idempotencyKey: crypto.randomUUID(),
      giftCardActivity: {
        type: isIncrement ? "ADJUST_INCREMENT" : "ADJUST_DECREMENT",
        locationId,
        giftCardId,
        [payloadKey]: {
          amountMoney: {
            amount,
            currency,
          },
          reason: reason || "Manual adjustment",
        },
      },
    }),
  );
};

const retrieveGiftCardByGan = async (gan) => {
  const value = gan && gan.trim();
  if (!value) {
    throw new Error("GAN is required");
  }
  const { result } = await safeCall(() =>
    giftCardsApi.retrieveGiftCardFromGAN({ gan: value }),
  );
  return mapGiftCard(result.giftCard);
};

const searchGiftCard = async (query) => {
  if (!query) return null;
  const value = query.trim();
  if (!value) return null;
  try {
    return await retrieveGiftCard(value);
  } catch (error) {
    // continue to GAN lookup
  }
  try {
    return await retrieveGiftCardByGan(value);
  } catch (error) {
    return null;
  }
};

module.exports = {
  centsFromAmount,
  listGiftCards,
  listGiftCardActivities,
  issueGiftCard,
  loadGiftCardBalance,
  buildGiftCardStats,
  retrieveGiftCard,
  retrieveGiftCardByGan,
  searchGiftCard,
  blockGiftCard,
  unblockGiftCard,
  adjustGiftCardBalance,
};
