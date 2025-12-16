const giftCardCache = require("./gift-card-cache");
const { retrieveGiftCard, listGiftCards } = require("./gift-card-service");

const DEFAULT_INTERVAL_MS =
  Number(process.env.GIFT_CARD_RECONCILE_INTERVAL_MS) || 1000 * 60 * 60 * 24;

let reconcileTimer = null;

const safeSync = async (giftCardId, metadata = {}) => {
  if (!giftCardId) return null;
  const card = await retrieveGiftCard(giftCardId);
  giftCardCache.upsertCard({
    ...card,
    lastSyncSource: metadata.source || "manual",
    lastEventType: metadata.eventType || null,
  });
  return card;
};

const handleGiftCardWebhookEvent = async (eventType, data) => {
  if (!eventType || !data) return;
  const giftCardId =
    data?.object?.gift_card?.id ||
    data?.object?.gift_card_activity?.gift_card_id ||
    data?.object?.gift_card_activity?.gift_card?.id;
  if (!giftCardId) return;
  try {
    await safeSync(giftCardId, { source: "webhook", eventType });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[GiftCards] webhook sync failed", giftCardId, error.message);
  }
};

const fetchAllGiftCards = async () => {
  const cards = [];
  let cursor;
  do {
    const listOptions = { limit: 50 };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const { cards: batch, cursor: nextCursor } =
      await listGiftCards(listOptions);
    cards.push(...batch);
    cursor = nextCursor;
  } while (cursor);
  return cards;
};

const reconcileGiftCards = async () => {
  try {
    const cards = await fetchAllGiftCards();
    const cachedSnapshot = new Map(
      giftCardCache.listCards().map((card) => [card.id, card]),
    );
    cards.forEach((card) => {
      if (!card || !card.id) return;
      const cached = cachedSnapshot.get(card.id);
      cachedSnapshot.delete(card.id);
      if (
        cached &&
        cached.balance?.amount === card.balance?.amount &&
        cached.state === card.state
      ) {
        giftCardCache.upsertCard({
          ...card,
          lastSyncSource: "reconciler",
        });
        return;
      }
      if (cached) {
        giftCardCache.recordDiscrepancy({
          giftCardId: card.id,
          kind: "BALANCE_MISMATCH",
          cachedBalance: cached.balance?.amount ?? null,
          squareBalance: card.balance?.amount ?? null,
          cachedState: cached.state || null,
          squareState: card.state || null,
        });
      } else {
        giftCardCache.recordDiscrepancy({
          giftCardId: card.id,
          kind: "MISSING_LOCAL",
          cachedBalance: null,
          squareBalance: card.balance?.amount ?? null,
          squareState: card.state || null,
        });
      }
      giftCardCache.upsertCard({
        ...card,
        lastSyncSource: "reconciler",
      });
    });

    cachedSnapshot.forEach((cached) => {
      giftCardCache.recordDiscrepancy({
        giftCardId: cached.id,
        kind: "MISSING_SQUARE",
        cachedBalance: cached.balance?.amount ?? null,
        squareBalance: null,
        cachedState: cached.state || null,
      });
    });

    giftCardCache.markReconciled();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[GiftCards] reconciliation failed", error.message);
  }
};

const startGiftCardReconciler = () => {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.GIFT_CARD_DISABLE_SYNC === "true") return;
  if (reconcileTimer) return;
  reconcileGiftCards();
  reconcileTimer = setInterval(reconcileGiftCards, DEFAULT_INTERVAL_MS);
};

module.exports = {
  handleGiftCardWebhookEvent,
  startGiftCardReconciler,
  safeSync,
};
