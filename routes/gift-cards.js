const express = require("express");
const {
  listGiftCards,
  listGiftCardActivities,
  issueGiftCard,
  loadGiftCardBalance,
  centsFromAmount,
  buildGiftCardStats,
  retrieveGiftCard,
  blockGiftCard,
  unblockGiftCard,
  adjustGiftCardBalance,
} = require("../util/gift-card-service");
const { locationsApi } = require("../util/square-client");
const giftCardCache = require("../util/gift-card-cache");

const router = express.Router();

const GIFT_CARD_TYPES = ["DIGITAL", "PHYSICAL"];
const GIFT_CARD_STATES = [
  "ACTIVE",
  "BLOCKED",
  "DEACTIVATED",
  "PENDING",
];

const resolveEnvStatus = () => {
  const squareEnv = (
    process.env.SQUARE_ENVIRONMENT ||
    process.env.NODE_ENV ||
    "sandbox"
  ).toLowerCase();
  return squareEnv === "production"
    ? { label: "Live", tone: "live" }
    : { label: "Testing", tone: "testing" };
};

const fetchPrimaryLocationId = async () => {
  const {
    result: { location },
  } = await locationsApi.retrieveLocation("main");
  return location.id;
};

router.get("/", async (req, res, next) => {
  try {
    const {
      type: typeFilter,
      state: stateFilter,
      customerId: customerFilter,
      activityCardId,
    } = req.query;
    const listOptions = {
      limit: 25,
      type: typeFilter || undefined,
      state: stateFilter || undefined,
      customerId: customerFilter || undefined,
    };
    const activityOptions = {
      limit: 25,
      giftCardId: activityCardId || customerFilter || undefined,
    };
    const [cardsResult, activityResult, locationId] = await Promise.all([
      listGiftCards(listOptions),
      listGiftCardActivities(activityOptions),
      fetchPrimaryLocationId(),
    ]);
    const stats = buildGiftCardStats(cardsResult.cards);
    res.render("gift-cards", {
      giftCards: cardsResult.cards,
      cardsCursor: cardsResult.cursor,
      activities: activityResult.activities,
      activitiesCursor: activityResult.cursor,
      stats,
      envStatus: resolveEnvStatus(),
      message: req.query.status,
      errorMessage: req.query.error,
      locationId,
      filters: {
        type: typeFilter || "",
        state: stateFilter || "",
        customerId: customerFilter || "",
        activityCardId: activityCardId || "",
      },
      filterChoices: {
        types: GIFT_CARD_TYPES,
        states: GIFT_CARD_STATES,
      },
      syncMeta: {
        lastReconciledAt: giftCardCache.getLastReconciledAt(),
        discrepancies: giftCardCache.listDiscrepancies(5),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/issue", async (req, res, next) => {
  try {
    const {
      type,
      amount,
      currency = "USD",
      customerId,
      referenceId,
    } = req.body;
    const amountCents = centsFromAmount(amount);
    const locationId = await fetchPrimaryLocationId();
    await issueGiftCard({
      type: type || "DIGITAL",
      amountCents,
      currency: currency || "USD",
      customerId: customerId || undefined,
      referenceId: referenceId || undefined,
      locationId,
    });
    res.redirect("/gift-cards?status=issued");
  } catch (error) {
    const detail = error.message || "Unable to issue gift card";
    res.redirect(`/gift-cards?error=${encodeURIComponent(detail)}`);
  }
});

router.post("/load", async (req, res, next) => {
  try {
    const { giftCardId, amount, currency = "USD", referenceId } = req.body;
    const amountCents = centsFromAmount(amount);
    const locationId = await fetchPrimaryLocationId();
    await loadGiftCardBalance({
      giftCardId,
      amountCents,
      currency: currency || "USD",
      referenceId: referenceId || undefined,
      locationId,
    });
    res.redirect("/gift-cards?status=loaded");
  } catch (error) {
    const detail = error.message || "Unable to load gift card";
    res.redirect(`/gift-cards?error=${encodeURIComponent(detail)}`);
  }
});

router.get("/:giftCardId/detail", async (req, res) => {
  try {
    const { giftCardId } = req.params;
    const [card, activityResult] = await Promise.all([
      retrieveGiftCard(giftCardId),
      listGiftCardActivities({ giftCardId, limit: 50 }),
    ]);
    res.json({
      card,
      activities: activityResult.activities,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Unable to load gift card detail",
    });
  }
});

router.post("/:giftCardId/block", async (req, res) => {
  try {
    const { giftCardId } = req.params;
    const { reason } = req.body;
    const locationId = await fetchPrimaryLocationId();
    await blockGiftCard({ giftCardId, locationId, reason });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Unable to block gift card",
    });
  }
});

router.post("/:giftCardId/unblock", async (req, res) => {
  try {
    const { giftCardId } = req.params;
    const { reason } = req.body;
    const locationId = await fetchPrimaryLocationId();
    await unblockGiftCard({ giftCardId, locationId, reason });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Unable to unblock gift card",
    });
  }
});

router.post("/:giftCardId/adjust", async (req, res) => {
  try {
    const { giftCardId } = req.params;
    const { amount, currency = "USD", reason } = req.body;
    const amountCents = centsFromAmount(amount);
    const locationId = await fetchPrimaryLocationId();
    await adjustGiftCardBalance({
      giftCardId,
      amountCents,
      currency,
      locationId,
      reason,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || "Unable to adjust card balance",
    });
  }
});

module.exports = router;
