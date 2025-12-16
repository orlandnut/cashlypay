const express = require("express");
const {
  listGiftCards,
  listGiftCardActivities,
  issueGiftCard,
  loadGiftCardBalance,
  centsFromAmount,
  buildGiftCardStats,
} = require("../util/gift-card-service");
const { locationsApi } = require("../util/square-client");

const router = express.Router();

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
    const [cardsResult, activityResult, locationId] = await Promise.all([
      listGiftCards({ limit: 25 }),
      listGiftCardActivities({ limit: 25 }),
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

module.exports = router;
