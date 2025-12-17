/*
Copyright 2020 Square Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const express = require("express");
const crypto = require("crypto");
const activityStore = require("../util/activity-store");
const reminderQueue = require("../util/reminder-queue");
const { handleGiftCardWebhookEvent } = require("../util/gift-card-sync");

const router = express.Router();

const buildNotificationUrl = (req) => {
  if (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL) {
    return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  }
  const host = req.get("host");
  if (!host || !req.protocol) {
    return null;
  }
  return `${req.protocol}://${host}${req.originalUrl}`;
};

const getRawPayload = (req) => {
  if (typeof req.rawBody === "string") {
    return req.rawBody;
  }
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  return JSON.stringify(req.body || {});
};

const verifySignature = (req) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    return true;
  }

  const signatureHeader = req.get("x-square-hmacsha256-signature");
  if (!signatureHeader) {
    return false;
  }

  const notificationUrl = buildNotificationUrl(req);
  if (!notificationUrl) {
    return false;
  }

  const payload = `${notificationUrl}${getRawPayload(req)}`;
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(payload);
  const expectedSignature = hmac.digest();

  let providedSignature;
  try {
    providedSignature = Buffer.from(signatureHeader, "base64");
  } catch (error) {
    return false;
  }

  if (providedSignature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedSignature, providedSignature);
};

router.post("/square", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ message: "Invalid webhook signature" });
  }

  const { type, data } = req.body || {};
  const invoice = data?.object?.invoice;

  if (!type) {
    return res.status(400).json({ message: "Missing event type" });
  }

  activityStore.addEvent({
    invoiceId: invoice?.id,
    type,
    payload: data,
  });

  if (invoice) {
    reminderQueue.scheduleFromInvoice(invoice);
  }

  if (
    type &&
    (type.startsWith("gift_card") || type.startsWith("gift_card_activity"))
  ) {
    await handleGiftCardWebhookEvent(type, { object: data?.object });
  }

  return res.status(200).json({ received: true });
});

module.exports = router;
