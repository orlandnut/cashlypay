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

const router = express.Router();

const verifySignature = (req) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    return true;
  }

  const signatureHeader = req.get("x-square-hmacsha256-signature");
  if (!signatureHeader) {
    return false;
  }

  const body = JSON.stringify(req.body || {});
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(body);
  const expected = hmac.digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
};

router.post("/square", (req, res) => {
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

  return res.status(200).json({ received: true });
});

module.exports = router;
