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
const Joi = require("joi");
const {
  customersApi,
  locationsApi,
  invoicesApi,
  ordersApi,
} = require("../util/square-client");
const serviceStore = require("../util/service-store");
const subscriptionStore = require("../util/subscription-store");

const router = express.Router();

const recurringSchema = Joi.object({
  customerId: Joi.string().required(),
  locationId: Joi.string().required(),
  serviceId: Joi.string().required(),
  amount: Joi.number().integer().positive().required(),
  currency: Joi.string().length(3).uppercase().required(),
  frequency: Joi.string().valid("WEEKLY", "MONTHLY").required(),
  startDate: Joi.string().isoDate().required(),
  occurrences: Joi.number().integer().min(1).max(24).required(),
  paymentMethod: Joi.string()
    .valid("CARD_ON_FILE", "BANK_ON_FILE", "MANUAL")
    .required(),
  allowCard: Joi.boolean().default(true),
  allowBank: Joi.boolean().default(false),
  allowGiftCard: Joi.boolean().default(true),
  allowCashApp: Joi.boolean().default(false),
  usageNotes: Joi.string().allow("").max(500).default(""),
});

const buildSchedule = (frequency, startDate) => {
  const schedule = {
    startDate,
    timezone: "UTC",
    recurrence: {
      period: frequency,
    },
  };

  const start = new Date(startDate);
  if (frequency === "MONTHLY") {
    schedule.recurrence.monthlyRecurrence = {
      dayOfMonth: start.getUTCDate(),
    };
  } else if (frequency === "WEEKLY") {
    const weekdays = [
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ];
    schedule.recurrence.weeklyRecurrence = {
      dayOfWeek: weekdays[start.getUTCDay()],
    };
  }

  return schedule;
};

router.get("/new/:locationId/:customerId", async (req, res, next) => {
  const { locationId, customerId } = req.params;
  try {
    const [
      {
        result: { customer },
      },
      {
        result: { location },
      },
    ] = await Promise.all([
      customersApi.retrieveCustomer(customerId),
      locationsApi.retrieveLocation(locationId),
    ]);

    res.render("subscription", {
      locationId,
      customer,
      serviceItems: serviceStore.list(),
      defaultCurrency: location.currency || "USD",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/create", async (req, res, next) => {
  let payload;
  try {
    const booleanFields = [
      "allowCard",
      "allowBank",
      "allowGiftCard",
      "allowCashApp",
    ];
    const normalizedBody = { ...req.body };
    booleanFields.forEach((field) => {
      normalizedBody[field] = Object.prototype.hasOwnProperty.call(
        req.body,
        field,
      )
        ? "true"
        : "false";
    });
    payload = await recurringSchema.validateAsync(normalizedBody, {
      abortEarly: false,
      stripUnknown: true,
    });
  } catch (error) {
    error.status = 400;
    return next(error);
  }

  try {
    const service = serviceStore.findById(payload.serviceId);
    if (!service) {
      const err = new Error("Selected service not available");
      err.status = 400;
      throw err;
    }

    const orderRequest = {
      order: {
        locationId: payload.locationId,
        customerId: payload.customerId,
        lineItems: [
          {
            name: `${service.name} Subscription`,
            quantity: "1",
            basePriceMoney: {
              amount: payload.amount,
              currency: payload.currency,
            },
          },
        ],
      },
      idempotencyKey: `${payload.customerId}-${Date.now()}`,
    };

    const {
      result: { order },
    } = await ordersApi.createOrder(orderRequest);

    const paymentRequests = [
      {
        requestType: "BALANCE",
        dueDate: payload.startDate,
        automaticPaymentSource:
          payload.paymentMethod === "MANUAL" ? "NONE" : payload.paymentMethod,
        reminders: [
          {
            message: "Recurring invoice coming up",
            relativeScheduledDays: -1,
          },
        ],
      },
    ];

    const invoiceBody = {
      idempotencyKey: `${payload.customerId}-${payload.locationId}-${Date.now()}`,
      invoice: {
        orderId: order.id,
        primaryRecipient: { customerId: payload.customerId },
        title: `${service.name} ${payload.frequency.toLowerCase()} plan`,
        description: payload.usageNotes || "Recurring service",
        deliveryMethod: "EMAIL",
        paymentRequests,
        acceptedPaymentMethods: {
          card: payload.allowCard,
          bankAccount: payload.allowBank,
          squareGiftCard: payload.allowGiftCard,
          cashAppPay: payload.allowCashApp,
        },
        schedule: buildSchedule(payload.frequency, payload.startDate),
        customFields: [
          {
            label: "Subscription Frequency",
            value: payload.frequency,
          },
        ],
      },
    };

    const {
      result: { invoice },
    } = await invoicesApi.createInvoice(invoiceBody);

    subscriptionStore.create({
      customerId: payload.customerId,
      locationId: payload.locationId,
      serviceId: payload.serviceId,
      serviceName: service.name,
      amount: payload.amount,
      currency: payload.currency,
      frequency: payload.frequency,
      startDate: payload.startDate,
      occurrences: payload.occurrences,
      paymentMethod: payload.paymentMethod,
      usageNotes: payload.usageNotes,
      invoiceId: invoice.id,
      allowCard: payload.allowCard,
      allowBank: payload.allowBank,
      allowGiftCard: payload.allowGiftCard,
      allowCashApp: payload.allowCashApp,
    });

    res.redirect(
      `view/${payload.locationId}/${payload.customerId}/${invoice.id}`,
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
