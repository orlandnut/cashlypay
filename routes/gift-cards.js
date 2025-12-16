const express = require("express");
const {
  listGiftCards,
  listGiftCardActivities,
  issueGiftCard,
  loadGiftCardBalance,
  centsFromAmount,
  buildGiftCardStats,
  retrieveGiftCard,
  searchGiftCard,
  blockGiftCard,
  unblockGiftCard,
  adjustGiftCardBalance,
} = require("../util/gift-card-service");
const { locationsApi, customersApi } = require("../util/square-client");
const giftCardCache = require("../util/gift-card-cache");
const activityStore = require("../util/activity-store");
const { requireRole } = require("../middleware/user");

const router = express.Router();

const GIFT_CARD_TYPES = ["DIGITAL", "PHYSICAL"];
const GIFT_CARD_STATES = [
  "ACTIVE",
  "BLOCKED",
  "DEACTIVATED",
  "PENDING",
];
const LIMIT_OPTIONS = [10, 25, 50];
const BUILT_IN_PRESETS = [
  { label: "Active cards", params: { state: "ACTIVE" } },
  { label: "Blocked cards", params: { state: "BLOCKED" } },
  { label: "Digital cards", params: { type: "DIGITAL" } },
];

const sanitizeLimit = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  if (LIMIT_OPTIONS.includes(parsed)) return parsed;
  return fallback;
};

const buildQueryString = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.append(key, value);
  });
  return search.toString();
};

const appendToQuery = (base, extra = {}) => {
  const search = new URLSearchParams(base || "");
  Object.entries(extra).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, value);
  });
  return search.toString();
};

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

const logGiftCardAction = (req, type, payload) => {
  activityStore.addEvent({
    type: `GIFT_CARD_${type}`,
    payload,
    actor:
      req.user?.email ||
      req.user?.id ||
      req.user?.name ||
      process.env.DEFAULT_USER_EMAIL ||
      "unknown",
  });
};

router.get("/", async (req, res, next) => {
  try {
    const {
      type: typeFilter,
      state: stateFilter,
      customerId: customerFilter,
      activityCardId,
      cursor,
      activityCursor,
      limit: limitParam,
      activityLimit: activityLimitParam,
      q: searchQueryRaw,
    } = req.query;
    const limit = sanitizeLimit(limitParam, 25);
    const activityLimit = sanitizeLimit(activityLimitParam, 25);
    const searchQuery =
      typeof searchQueryRaw === "string" ? searchQueryRaw.trim() : "";
    const listOptions = {
      limit,
      type: typeFilter || undefined,
      state: stateFilter || undefined,
      customerId: customerFilter || undefined,
    };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const activityOptions = {
      limit: activityLimit,
      giftCardId: activityCardId || customerFilter || undefined,
      cursor: activityCursor || undefined,
    };
    const locationPromise = fetchPrimaryLocationId();
    const customersPromise = customersApi
      .listCustomers()
      .then(({ result }) => {
        const list = result?.customers || [];
        return list.map((customer) => ({
          id: customer.id,
          label:
            `${customer.givenName || "Customer"} ${customer.familyName || ""}`.trim() ||
            customer.id,
          email: customer.emailAddress || "",
        }));
      })
      .catch(() => []);
    let cardsResult;
    const searchMeta = {
      query: searchQuery,
      notFound: false,
    };
    if (searchQuery) {
      const foundCard = await searchGiftCard(searchQuery);
      if (foundCard) {
        cardsResult = { cards: [foundCard], cursor: null };
        activityOptions.giftCardId = foundCard.id;
      } else {
        cardsResult = { cards: [], cursor: null };
        searchMeta.notFound = true;
      }
    } else {
      cardsResult = await listGiftCards(listOptions);
    }
    const [activityResult, locationId, customerOptions] = await Promise.all([
      listGiftCardActivities(activityOptions),
      locationPromise,
      customersPromise,
    ]);
    const stats = buildGiftCardStats(cardsResult.cards);
    const baseQueryParams = {
      type: typeFilter || "",
      state: stateFilter || "",
      customerId: customerFilter || "",
      activityCardId: activityCardId || "",
      limit,
      q: searchQuery,
    };
    const baseQueryString = buildQueryString(baseQueryParams);
    const activityBaseQueryString = buildQueryString({
      ...baseQueryParams,
      activityLimit,
    });
    const pagination = {
      cards:
        !searchQuery && cardsResult.cursor
          ? `/gift-cards?${appendToQuery(baseQueryString, {
              cursor: cardsResult.cursor,
            })}`
          : null,
      activities: activityResult.cursor
        ? `/gift-cards?${appendToQuery(activityBaseQueryString, {
            activityCursor: activityResult.cursor,
          })}`
        : null,
    };

    const auditLogs = activityStore.listByTypePrefix
      ? activityStore.listByTypePrefix("GIFT_CARD", 12)
      : [];

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
        limit,
        activityLimit,
        q: searchQuery,
      },
      filterChoices: {
        types: GIFT_CARD_TYPES,
        states: GIFT_CARD_STATES,
        limitOptions: LIMIT_OPTIONS,
        presets: BUILT_IN_PRESETS.map((preset) => ({
          label: preset.label,
          query: buildQueryString({ ...preset.params, limit }),
        })),
      },
      pagination,
      searchMeta,
      customerOptions,
      auditLogs,
      syncMeta: {
        lastReconciledAt: giftCardCache.getLastReconciledAt(),
        discrepancies: giftCardCache.listDiscrepancies(5),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/issue", requireRole("finance", "admin"), async (req, res, next) => {
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
    const issuedCard = await issueGiftCard({
      type: type || "DIGITAL",
      amountCents,
      currency: currency || "USD",
      customerId: customerId || undefined,
      referenceId: referenceId || undefined,
      locationId,
    });
    logGiftCardAction(req, "ISSUE", {
      cardId: issuedCard?.id,
      amountCents,
      currency,
      customerId,
      referenceId,
    });
    res.redirect("/gift-cards?status=issued");
  } catch (error) {
    const detail = error.message || "Unable to issue gift card";
    res.redirect(`/gift-cards?error=${encodeURIComponent(detail)}`);
  }
});

router.post("/load", requireRole("finance", "admin"), async (req, res, next) => {
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
    logGiftCardAction(req, "LOAD", {
      cardId: giftCardId,
      amountCents,
      currency,
      referenceId,
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

router.post(
  "/:giftCardId/block",
  requireRole("finance", "admin"),
  async (req, res) => {
    try {
      const { giftCardId } = req.params;
      const { reason } = req.body;
      const locationId = await fetchPrimaryLocationId();
      await blockGiftCard({ giftCardId, locationId, reason });
      logGiftCardAction(req, "BLOCK", { cardId: giftCardId, reason });
      res.json({ success: true });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || "Unable to block gift card",
      });
    }
  },
);

router.post(
  "/:giftCardId/unblock",
  requireRole("finance", "admin"),
  async (req, res) => {
    try {
      const { giftCardId } = req.params;
      const { reason } = req.body;
      const locationId = await fetchPrimaryLocationId();
      await unblockGiftCard({ giftCardId, locationId, reason });
      logGiftCardAction(req, "UNBLOCK", { cardId: giftCardId, reason });
      res.json({ success: true });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || "Unable to unblock gift card",
      });
    }
  },
);

router.post(
  "/:giftCardId/adjust",
  requireRole("finance", "admin"),
  async (req, res) => {
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
      logGiftCardAction(req, "ADJUST", {
        cardId: giftCardId,
        amountCents,
        currency,
        reason,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message || "Unable to adjust card balance",
      });
    }
  },
);

module.exports = router;
