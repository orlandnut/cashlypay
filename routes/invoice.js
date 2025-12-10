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
const Joi = require("joi");
const {
  cardsApi,
  ordersApi,
  invoicesApi,
  locationsApi,
  customersApi,
} = require("../util/square-client");
const estimateStore = require("../util/estimate-store");
const reminderQueue = require("../util/reminder-queue");
const activityStore = require("../util/activity-store");
const milestoneStore = require("../util/milestone-store");
const serviceStore = require("../util/service-store");

const router = express.Router();

const MERCHANT_SUBSCRIPTION_NOT_FOUND_CODE = "MERCHANT_SUBSCRIPTION_NOT_FOUND";

const createInvoiceSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  locationId: Joi.string().trim().required(),
  idempotencyKey: Joi.string().trim().min(10).max(64).required(),
  priceAmount: Joi.number().integer().positive().required(),
  name: Joi.string().trim().max(255).required(),
  currency: Joi.string().trim().uppercase().length(3).optional(),
  allowCard: Joi.boolean()
    .truthy("true", "1", "on")
    .falsy("false", "0", "off")
    .default(true),
  allowBank: Joi.boolean()
    .truthy("true", "1", "on")
    .falsy("false", "0", "off")
    .default(false),
  allowGiftCard: Joi.boolean()
    .truthy("true", "1", "on")
    .falsy("false", "0", "off")
    .default(true),
  allowCashApp: Joi.boolean()
    .truthy("true", "1", "on")
    .falsy("false", "0", "off")
    .default(false),
  paymentSource: Joi.string()
    .valid("AUTO", "CARD_ON_FILE", "BANK_ON_FILE", "NONE")
    .default("AUTO"),
});

const publishInvoiceSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  locationId: Joi.string().trim().required(),
  idempotencyKey: Joi.string().trim().min(10).max(64).required(),
  invoiceId: Joi.string().trim().required(),
  invoiceVersion: Joi.number().integer().min(0).required(),
});

const mutateInvoiceSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  locationId: Joi.string().trim().required(),
  invoiceId: Joi.string().trim().required(),
  invoiceVersion: Joi.number().integer().min(0).required(),
});

const convertEstimateSchema = Joi.object({
  estimateId: Joi.string().required(),
  customerId: Joi.string().required(),
  locationId: Joi.string().required(),
  idempotencyKey: Joi.string().trim().min(10).max(64).required(),
});

const milestoneItemSchema = Joi.object({
  label: Joi.string().trim().required(),
  amount: Joi.number().integer().positive().required(),
  currency: Joi.string().trim().uppercase().length(3).required(),
  dueDate: Joi.string().optional().allow("", null),
  paymentSource: Joi.string()
    .valid("AUTO", "CARD_ON_FILE", "BANK_ON_FILE", "NONE")
    .default("AUTO"),
  allowCard: Joi.boolean().default(true),
  allowBank: Joi.boolean().default(false),
  allowGiftCard: Joi.boolean().default(true),
  allowCashApp: Joi.boolean().default(false),
});

const milestoneInvoiceSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  locationId: Joi.string().trim().required(),
  idempotencyKey: Joi.string().trim().min(10).max(64).required(),
  serviceName: Joi.string().trim().required(),
  currency: Joi.string().trim().uppercase().length(3).required(),
  notes: Joi.string().allow("", null),
  milestones: Joi.array().items(milestoneItemSchema).min(2).required(),
});

const validateRequest = (schema, payload) => {
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const validationError = new Error("Invalid request payload");
    validationError.status = 400;
    validationError.errors = error.details.map((detail) => detail.message);
    throw validationError;
  }

  return value;
};

const buildPaymentRequestsFromEstimate = (estimate, currency) => {
  const paymentRequests = [];
  const now = new Date();
  const depositDue = new Date(now);
  depositDue.setDate(now.getDate() + 3);
  const balanceDue = new Date(now);
  balanceDue.setDate(now.getDate() + 10);

  const automaticSource =
    estimate.paymentSource && estimate.paymentSource !== "AUTO"
      ? estimate.paymentSource
      : "NONE";

  if (estimate.depositPercentage > 0 && estimate.depositAmount > 0) {
    const depositRequest = {
      requestType: "DEPOSIT",
      dueDate: depositDue.toISOString().split("T")[0],
      amountMoney: {
        amount: estimate.depositAmount,
        currency,
      },
    };
    if (automaticSource !== "NONE") {
      depositRequest.automaticPaymentSource = automaticSource;
    }
    paymentRequests.push(depositRequest);
  }

  paymentRequests.push({
    requestType: "BALANCE",
    dueDate: balanceDue.toISOString().split("T")[0],
    automaticPaymentSource: automaticSource,
    reminders: [
      {
        message: "Payment due soon",
        relativeScheduledDays: -2,
      },
    ],
  });

  return paymentRequests;
};

const addPricingDetailsToOrder = (order, estimate) => {
  if (estimate.discountPercent) {
    order.discounts = [
      {
        name: "Estimate Discount",
        percentage: estimate.discountPercent.toFixed(2),
        scope: "ORDER",
      },
    ];
  }

  if (estimate.taxPercent) {
    order.taxes = [
      {
        name: "Tax",
        percentage: estimate.taxPercent.toFixed(2),
        scope: "ORDER",
      },
    ];
  }

  if (estimate.surchargeAmount) {
    order.serviceCharges = [
      {
        name: "Surcharge",
        amountMoney: {
          amount: estimate.surchargeAmount,
          currency: estimate.currency,
        },
      },
    ];
  }
};

const buildCustomFieldsFromEstimate = (estimate) => {
  const customFields = [
    {
      label: "Estimate ID",
      value: estimate.id,
    },
  ];

  if (estimate.poNumber) {
    customFields.push({
      label: "PO Number",
      value: estimate.poNumber,
    });
  }

  if (estimate.customNotes) {
    customFields.push({
      label: "Customer Notes",
      value: estimate.customNotes,
    });
  }

  if (estimate.attachments && estimate.attachments.length) {
    customFields.push({
      label: "Attachments",
      value: estimate.attachments
        .map((attachment) => `${attachment.name}: ${attachment.url}`)
        .join(" | "),
    });
  }

  return customFields;
};

const buildDefaultMilestonePlan = (totalAmount, currency) => {
  if (!totalAmount) {
    return [
      {
        label: "Mobilization",
        amount: 0,
        currency,
        allowCard: true,
        allowGiftCard: true,
      },
    ];
  }
  const template = [
    { label: "Mobilization", percentage: 0.3 },
    { label: "Progress Draw", percentage: 0.5 },
    { label: "Retention", percentage: 0.2 },
  ];
  let remaining = totalAmount;
  return template.map((stage, index) => {
    let amount = Math.round(totalAmount * stage.percentage);
    if (index === template.length - 1) {
      amount = remaining;
    }
    remaining -= amount;
    return {
      label: stage.label,
      amount,
      currency,
      allowCard: true,
      allowGiftCard: true,
    };
  });
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
};

const parseMilestonePayload = (rawMilestones) => {
  if (Array.isArray(rawMilestones)) return rawMilestones;
  if (typeof rawMilestones === "string") {
    try {
      const parsed = JSON.parse(rawMilestones);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return [];
    }
  }
  return [];
};

const aggregatePaymentMethods = (milestones) => {
  return {
    allowCard: milestones.some((mile) => mile.allowCard !== false),
    allowBank: milestones.some((mile) => mile.allowBank),
    allowGiftCard: milestones.some((mile) => mile.allowGiftCard !== false),
    allowCashApp: milestones.some((mile) => mile.allowCashApp),
  };
};

const resolveAutomaticSource = (requestedSource, cards) => {
  if (requestedSource && requestedSource !== "AUTO") return requestedSource;
  if (cards && cards.length) {
    return "CARD_ON_FILE";
  }
  return "NONE";
};

const buildPaymentRequestsFromMilestones = (milestones, cards) => {
  return milestones.map((milestone, index) => {
    const requestType =
      index === 0
        ? "DEPOSIT"
        : index === milestones.length - 1
          ? "BALANCE"
          : "INSTALLMENT";
    const automaticPaymentSource = resolveAutomaticSource(
      milestone.paymentSource,
      cards,
    );
    const request = {
      requestType,
      dueDate: normalizeDateOnly(milestone.dueDate),
      amountMoney: {
        amount: milestone.amount,
        currency: milestone.currency,
      },
      reminders: [
        {
          message: `${milestone.label} payment due soon`,
          relativeScheduledDays: -1,
        },
      ],
      automaticPaymentSource,
    };
    if (automaticPaymentSource === "CARD_ON_FILE" && cards?.length) {
      request.cardId = cards[0].id;
    }
    return request;
  });
};

/**
 * Matches: GET /invoice/view/:locationId/:customerId/:invoiceId
 *
 * Description:
 *  Renders the invoice detail view page that with buttons
 *  that can update the status of the invoice.
 *
 * Query Parameters:
 *  locationId: Id of the location that the invoice belongs to
 *  customerId: Id of the selected customer
 *  invoiceId: Id of the selected invoice
 */
router.get(
  "/view/:locationId/:customerId/:invoiceId",
  async (req, res, next) => {
    const { locationId, customerId, invoiceId } = req.params;
    try {
      // Get the invoice by invoice id
      const {
        result: { invoice },
      } = await invoicesApi.getInvoice(invoiceId);

      // Helper function to format dates
      const formatDate = (dateString) => {
        if (!dateString) return "Not specified";
        const date = new Date(dateString);
        return new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
        }).format(date);
      };

      const paymentRequest =
        Array.isArray(invoice.paymentRequests) && invoice.paymentRequests.length
          ? invoice.paymentRequests.find(
              (request) => request.requestType === "BALANCE",
            ) || invoice.paymentRequests[0]
          : null;

      const paymentAmountRaw =
        paymentRequest?.computedAmountMoney?.amount ??
        paymentRequest?.total?.amount ??
        paymentRequest?.amountMoney?.amount ??
        0;
      const paymentAmount = Number(paymentAmountRaw) || 0;

      const paymentDueDate =
        paymentRequest?.dueDate ||
        invoice.dueDate ||
        invoice.scheduledAt ||
        null;
      const paymentMethod = paymentRequest?.automaticPaymentSource || "NONE";

      const recipient = invoice.primaryRecipient || {};
      const recipientName =
        [recipient.givenName, recipient.familyName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        recipient.companyName ||
        "Customer";
      const recipientEmail = recipient.emailAddress || null;

      // Render the invoice detail view page
      const activities = activityStore.listByInvoice(invoiceId);

      res.render("invoice", {
        locationId,
        customerId,
        invoice,
        paymentAmount,
        paymentDueDate,
        paymentMethod,
        recipientName,
        recipientEmail,
        formatDate,
        idempotencyKey: crypto.randomUUID(),
        activities,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/milestones/new/:locationId/:customerId",
  async (req, res, next) => {
    try {
      const { locationId, customerId } = req.params;
      const services = serviceStore.list();
      const selectedService =
        services.find((svc) => svc.id === req.query.serviceId) || services[0];
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
      const currency = selectedService?.currency || location.currency || "USD";
      const defaultPlan = buildDefaultMilestonePlan(
        selectedService?.priceAmount || 0,
        currency,
      ).map((milestone, index) => ({
        ...milestone,
        dueDate: normalizeDateOnly(
          new Date(Date.now() + (index + 1) * 7 * 24 * 60 * 60 * 1000),
        ),
      }));
      res.render("invoice/milestones", {
        customer,
        location,
        services,
        selectedService,
        milestonePlan: defaultPlan,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Matches: POST /invoice/create
 *
 * Description:
 *  Take the order item information and create an invoice.
 *  In this example, the invoice is created and scheduled to be sent
 *  at 10 minutes after the creation and payment due date is 7 days
 *  after the creation date.
 *
 *  The invoice is created to charge customer's card on file by default
 *  if there is an card on file. Otherwise, the invoice will be sent and
 *  paid by customer through the invoice's public url.
 *
 * Request Body:
 *  customerId: Id of the selected customer
 *  locationId: Id of the location that the invoice belongs to
 *  idempotencyKey: Unique identifier for request from client
 *  priceAmount: The amount of price for the order item
 *  name: The name of the order item
 */
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
    payload = validateRequest(createInvoiceSchema, normalizedBody);
  } catch (validationError) {
    return next(validationError);
  }

  const {
    customerId,
    locationId,
    idempotencyKey,
    priceAmount,
    name,
    currency: requestedCurrency,
    allowCard,
    allowBank,
    allowGiftCard,
    allowCashApp,
    paymentSource,
  } = payload;

  try {
    // Step 1: Fetch cards for the customer
    const {
      result: { cards },
    } = await cardsApi.listCards(undefined, customerId);

    // Step 2: Fetch location currency
    const locationResponse = await locationsApi.retrieveLocation(locationId);
    const currency =
      requestedCurrency || locationResponse.result.location.currency;

    // Step 3: Create an order to be attached to the invoice
    const orderRequest = {
      order: {
        locationId,
        customerId,
        lineItems: [
          {
            name,
            quantity: "1",
            basePriceMoney: {
              amount: priceAmount,
              currency,
            },
          },
        ],
      },
      idempotencyKey, // Unique identifier for request
    };

    const {
      result: { order },
    } = await ordersApi.createOrder(orderRequest);

    // We set two important time below, scheduledAt and dueDate.
    // scheduledAt is when the invoice will be delivered to the buyer
    // and dueDate is when the invoice will be charged.
    // If scheduledAt is before the due date, it will send an email with an explanation that
    // the card on file will be charged on the due date
    // if the scheduledAt is the same date as the due date (in the location timezone)
    // it will charge at the scheduledAt time and send a receipt after, instead of sending the upcoming charge notification.
    // scheduledAt should be never after dueDate.

    // Step 4: Set the due date to 7 days from today
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    const dueDateString = dueDate.toISOString().split("T")[0];

    // Step 5: Set the scheduledAt to next 10 minutes
    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000);
    const scheduledAtString = scheduledAt.toISOString();

    // Step 6: Set the payment request based on the customer's card on file status
    let paymentRequest = null;
    if (paymentSource === "CARD_ON_FILE") {
      paymentRequest = {
        requestType: "BALANCE",
        automaticPaymentSource: "CARD_ON_FILE",
        dueDate: dueDateString,
        cardId: cards?.[0]?.id,
      };
    } else if (paymentSource === "BANK_ON_FILE") {
      paymentRequest = {
        requestType: "BALANCE",
        automaticPaymentSource: "BANK_ON_FILE",
        dueDate: dueDateString,
      };
    } else if (paymentSource === "NONE") {
      paymentRequest = {
        requestType: "BALANCE",
        automaticPaymentSource: "NONE",
        dueDate: dueDateString,
        reminders: [
          {
            message: "Your invoice is due tomorrow",
            relativeScheduledDays: -1,
          },
        ],
      };
    } else if (cards && cards.length > 0) {
      // the current customer has a card on file
      // creating invoice with the payment request method CARD_ON_FILE
      // the invoice will be charged with the card on file on the due date
      paymentRequest = {
        requestType: "BALANCE",
        automaticPaymentSource: "CARD_ON_FILE",
        dueDate: dueDateString,
        cardId: cards[0].id, // Take the first card
      };
    } else {
      // the current customer doesn't have a card on file
      // creating invoice with the payment request method EMAIL and set a reminder
      // the invoice will be sent and paid by customer
      paymentRequest = {
        requestType: "BALANCE",
        automaticPaymentSource: "NONE",
        dueDate: dueDateString,
        reminders: [
          {
            message: "Your invoice is due tomorrow",
            relativeScheduledDays: -1,
          },
        ],
      };
    }

    // Step 7: Create the invoice
    const requestBody = {
      idempotencyKey,
      invoice: {
        deliveryMethod: "EMAIL",
        orderId: order.id,
        title: name,
        description: `Service: ${name}`,
        scheduledAt: scheduledAtString,
        primaryRecipient: {
          customerId,
        },
        paymentRequests: [paymentRequest],
        acceptedPaymentMethods: {
          bankAccount: allowBank,
          squareGiftCard: allowGiftCard,
          card: allowCard,
          cashAppPay: allowCashApp,
        },
        // Ensure line items are transferred from order
        lineItems: order.lineItems,
      },
    };

    let invoice;
    try {
      const invoiceResponse = await invoicesApi.createInvoice(requestBody);
      invoice = invoiceResponse.result.invoice;
    } catch (error) {
      /**
       * We need to check if the error is related to the invoice containing unsupported/premium features.
       * More information can be found here: https://developer.squareup.com/docs/invoices-api/overview#migration-notes
       */
      if (error.errors[0].code === MERCHANT_SUBSCRIPTION_NOT_FOUND_CODE) {
        /**
         * According to the migration guide linked above, we should retry the request after verifying the following:
         * 1. `custom_fields` must be empty or omitted.
         * 2. `payment_requests` cannot contain a payment request of the INSTALLMENT type.
         * The following piece of code is for demonstration purposes only and will not be used in this sample app as we hardcode the request body values.
         * To see it in action, change the above request type for the paymentRequest above to `INSTALLMENT`.
         * */
        const cleanRequestBody = { ...requestBody };
        cleanRequestBody.invoice.customFields = [];
        cleanRequestBody.invoice.paymentRequests[0].requestType = "BALANCE";

        const invoiceResponse =
          await invoicesApi.createInvoice(cleanRequestBody);
        invoice = invoiceResponse.result.invoice;
      } else {
        // If it's not a migration error, pass the error to the next middleware
        throw error;
      }
    }
    reminderQueue.scheduleFromInvoice(invoice);
    res.redirect(`view/${locationId}/${customerId}/${invoice.id}`);
  } catch (error) {
    next(error);
  }
});

router.post("/create-milestones", async (req, res, next) => {
  const rawMilestones = parseMilestonePayload(
    req.body.milestones || req.body.milestonesJson,
  );
  let payload;
  try {
    payload = validateRequest(milestoneInvoiceSchema, {
      ...req.body,
      milestones: rawMilestones,
    });
  } catch (validationError) {
    return next(validationError);
  }

  try {
    const milestones = payload.milestones.map((milestone, index) => ({
      ...milestone,
      dueDate:
        normalizeDateOnly(milestone.dueDate) ||
        normalizeDateOnly(
          new Date(Date.now() + (index + 1) * 7 * 24 * 60 * 60 * 1000),
        ),
    }));

    const totalAmount = milestones.reduce(
      (sum, milestone) => sum + milestone.amount,
      0,
    );
    if (totalAmount <= 0) {
      const error = new Error("Milestones total must be greater than zero");
      error.status = 400;
      throw error;
    }

    const {
      result: { cards },
    } = await cardsApi.listCards(undefined, payload.customerId);
    const locationResponse = await locationsApi.retrieveLocation(
      payload.locationId,
    );
    const currency =
      payload.currency || locationResponse.result.location.currency;
    milestones.forEach((milestone) => {
      if (milestone.currency !== currency) {
        throw new Error("All milestones must share the same currency");
      }
    });

    const orderRequest = {
      order: {
        locationId: payload.locationId,
        customerId: payload.customerId,
        lineItems: milestones.map((milestone) => ({
          name: `${payload.serviceName} - ${milestone.label}`,
          quantity: "1",
          basePriceMoney: {
            amount: milestone.amount,
            currency,
          },
        })),
      },
      idempotencyKey: payload.idempotencyKey,
    };

    const {
      result: { order },
    } = await ordersApi.createOrder(orderRequest);

    const paymentRequests = buildPaymentRequestsFromMilestones(
      milestones,
      cards,
    );
    const acceptedPayments = aggregatePaymentMethods(milestones);

    const requestBody = {
      idempotencyKey: payload.idempotencyKey,
      invoice: {
        deliveryMethod: "EMAIL",
        orderId: order.id,
        title: `${payload.serviceName} Milestone Plan`,
        description:
          payload.notes ||
          `${milestones.length} payment stages scheduled via Cashly.`,
        primaryRecipient: {
          customerId: payload.customerId,
        },
        paymentRequests,
        acceptedPaymentMethods: {
          bankAccount: acceptedPayments.allowBank,
          squareGiftCard: acceptedPayments.allowGiftCard,
          card: acceptedPayments.allowCard,
          cashAppPay: acceptedPayments.allowCashApp,
        },
      },
    };

    let invoice;
    try {
      const invoiceResponse = await invoicesApi.createInvoice(requestBody);
      invoice = invoiceResponse.result.invoice;
    } catch (error) {
      if (error?.errors?.[0]?.code === MERCHANT_SUBSCRIPTION_NOT_FOUND_CODE) {
        const fallbackBody = JSON.parse(JSON.stringify(requestBody));
        fallbackBody.invoice.paymentRequests =
          fallbackBody.invoice.paymentRequests.map((request) => ({
            ...request,
            requestType: "BALANCE",
          }));
        const invoiceResponse = await invoicesApi.createInvoice(fallbackBody);
        invoice = invoiceResponse.result.invoice;
      } else {
        throw error;
      }
    }

    milestoneStore.addMilestones(
      invoice.id,
      milestones.map((milestone) => ({
        ...milestone,
        allowCard: milestone.allowCard !== false,
        allowBank: !!milestone.allowBank,
        allowGiftCard: milestone.allowGiftCard !== false,
        allowCashApp: !!milestone.allowCashApp,
      })),
    );
    reminderQueue.scheduleFromInvoice(invoice);
    reminderQueue.scheduleMilestones(invoice, milestones);
    activityStore.addEvent({
      invoiceId: invoice.id,
      type: "MILESTONE_PLAN_CREATED",
      payload: {
        stages: milestones.map((milestone) => ({
          label: milestone.label,
          amount: milestone.amount,
          dueDate: milestone.dueDate,
        })),
      },
    });

    res.redirect(
      `view/${payload.locationId}/${payload.customerId}/${invoice.id}`,
    );
  } catch (error) {
    next(error);
  }
});

router.post("/convert-estimate", async (req, res, next) => {
  let payload;
  try {
    payload = validateRequest(convertEstimateSchema, req.body);
  } catch (validationError) {
    return next(validationError);
  }

  try {
    const estimate = estimateStore.getEstimate(payload.estimateId);
    if (!estimate) {
      const err = new Error("Estimate not found");
      err.status = 404;
      throw err;
    }

    if (estimate.status === "converted" && estimate.invoiceId) {
      return res.redirect(
        `view/${payload.locationId}/${payload.customerId}/${estimate.invoiceId}`,
      );
    }

    const orderRequest = {
      order: {
        locationId: payload.locationId,
        customerId: payload.customerId,
        lineItems: [
          {
            name: estimate.serviceName,
            quantity: "1",
            basePriceMoney: {
              amount: estimate.amount,
              currency: estimate.currency,
            },
          },
        ],
      },
      idempotencyKey: payload.idempotencyKey,
    };

    addPricingDetailsToOrder(orderRequest.order, estimate);

    const {
      result: { order },
    } = await ordersApi.createOrder(orderRequest);

    const paymentRequests = buildPaymentRequestsFromEstimate(
      estimate,
      estimate.currency,
    );

    const requestBody = {
      idempotencyKey: payload.idempotencyKey,
      invoice: {
        deliveryMethod: "EMAIL",
        orderId: order.id,
        title: `${estimate.serviceName} Estimate`,
        description: estimate.notes || "Generated from estimate",
        primaryRecipient: {
          customerId: payload.customerId,
        },
        paymentRequests,
        acceptedPaymentMethods: {
          bankAccount: estimate.allowBank,
          squareGiftCard: estimate.allowGiftCard,
          card: estimate.allowCard,
          cashAppPay: estimate.allowCashApp,
        },
        customFields: buildCustomFieldsFromEstimate(estimate),
      },
    };

    const {
      result: { invoice },
    } = await invoicesApi.createInvoice(requestBody);

    estimateStore.updateEstimate(estimate.id, {
      status: "converted",
      invoiceId: invoice.id,
      convertedAt: new Date().toISOString(),
    });

    reminderQueue.scheduleFromInvoice(invoice);
    res.redirect(
      `view/${payload.locationId}/${payload.customerId}/${invoice.id}`,
    );
  } catch (error) {
    next(error);
  }
});

/**
 * Matches: POST /invoice/publish
 *
 * Description:
 *  Publish the invoice.
 *
 * Request Body:
 *  idempotencyKey: Unique identifier for request from client
 *  customerId: Id of the selected customer
 *  locationId: Id of the location that the invoice belongs to
 *  invoiceId: Id of the invoice
 *  invoiceVersion: The version of the invoice
 */
router.post("/publish", async (req, res, next) => {
  let payload;
  try {
    payload = validateRequest(publishInvoiceSchema, req.body);
  } catch (validationError) {
    return next(validationError);
  }

  const { idempotencyKey, locationId, customerId, invoiceId, invoiceVersion } =
    payload;

  try {
    let versionToPublish = parseInt(invoiceVersion, 10);
    let latestInvoice = null;

    try {
      const {
        result: { invoice },
      } = await invoicesApi.getInvoice(invoiceId);
      latestInvoice = invoice;
      if (invoice?.version !== undefined) {
        versionToPublish = invoice.version;
      }
    } catch (lookupError) {
      // Proceed with the supplied version if lookup fails
      // eslint-disable-next-line no-console
      console.warn(
        `[Invoice] Failed to fetch latest version for ${invoiceId}: ${lookupError.message}`,
      );
    }

    if (latestInvoice) {
      const scheduledAtMs = latestInvoice.scheduledAt
        ? new Date(latestInvoice.scheduledAt).getTime()
        : 0;
      const now = Date.now();
      if (!scheduledAtMs || scheduledAtMs <= now) {
        const nextWindow = new Date(now + 10 * 60 * 1000).toISOString();
        try {
          const {
            result: { invoice: updatedInvoice },
          } = await invoicesApi.updateInvoice(invoiceId, {
            idempotencyKey: crypto.randomUUID(),
            invoice: {
              id: invoiceId,
              version: versionToPublish,
              scheduledAt: nextWindow,
            },
          });
          latestInvoice = updatedInvoice;
          versionToPublish = updatedInvoice.version;
        } catch (updateError) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Invoice] Failed to update scheduledAt for ${invoiceId}: ${updateError.message}`,
          );
        }
      }
    }

    // publish invoice
    const { result } = await invoicesApi.publishInvoice(invoiceId, {
      version: versionToPublish,
      idempotencyKey,
    });

    // redirect to the invoice detail view page
    res.redirect(`view/${locationId}/${customerId}/${result.invoice.id}`);
  } catch (error) {
    if (error?.errors?.length) {
      error.message = error.errors
        .map((err) => err.detail || err.message)
        .join(" | ");
      error.status = error.status || 400;
    }
    next(error);
  }
});

/**
 * Matches: POST /invoice/cancel
 *
 * Description:
 *  Cancel the invoice.
 *
 * Request Body:
 *  customerId: Id of the selected customer
 *  locationId: Id of the location that the invoice belongs to
 *  invoiceId: Id of the invoice
 *  invoiceVersion: The version of the invoice
 */
router.post("/cancel", async (req, res, next) => {
  let payload;
  try {
    payload = validateRequest(mutateInvoiceSchema, req.body);
  } catch (validationError) {
    return next(validationError);
  }

  const { locationId, customerId, invoiceId, invoiceVersion } = payload;

  try {
    // cancel invoice
    await invoicesApi.cancelInvoice(invoiceId, {
      version: parseInt(invoiceVersion),
    });

    // redirect to invoice detail view page
    res.redirect(`view/${locationId}/${customerId}/${invoiceId}`);
  } catch (error) {
    next(error);
  }
});

/**
 * Matches: POST /invoice/delete
 *
 * Description:
 *  Delete the invoice.
 *
 * Request Body:
 *  locationId: Id of the location that the invoice belongs to
 *  customerId: Id of the selected customer
 *  invoiceId: Id of the invoice
 *  invoiceVersion: The version of the invoice
 */
router.post("/delete", async (req, res, next) => {
  let payload;
  try {
    payload = validateRequest(mutateInvoiceSchema, req.body);
  } catch (validationError) {
    return next(validationError);
  }

  const { locationId, customerId, invoiceId, invoiceVersion } = payload;

  try {
    // delete the invoice
    await invoicesApi.deleteInvoice(invoiceId, parseInt(invoiceVersion));

    // invoice doesn't exist anymore, return to the invoice management page after delete the invoice
    res.redirect(`/management/${locationId}/${customerId}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
