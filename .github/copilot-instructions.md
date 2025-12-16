# CashlyPay AI Coding Agent Instructions

CashlyPay is an Express.js invoicing application built on the Square Payments SDK. It manages customers, invoices, estimates, subscriptions, gift cards, and payouts with role-based access control.

## Architecture Overview

**Core Stack**: Node.js + Express, SQLite (better-sqlite3), Pug templates, Square SDK

**Runtime Modes**: 
- Local development: `npm dev` (nodemon with hot reload)
- Production: `npm start` (Node.js server)
- Testing/Sandbox: `npm test` (test database)
- Serverless: Lambda via `serverless.yml` (handler.js wraps Express app)

**Key Components**:
- **Entry**: [app.js](app.js) - Express app setup, middleware chain (helmet, compression, rate-limiting, auth)
- **Routes**: [routes/](routes/) - Feature modules (invoice, estimate, customer, gift-cards, subscriptions, payouts, etc.)
- **Stores**: [util/](util/) - SQLite data access layer using better-sqlite3 prepared statements
- **Square Integration**: [util/square-client.js](util/square-client.js) - Singleton client with APIs (customersApi, invoicesApi, ordersApi, cardsApi, giftCardsApi)
- **Middleware**: [middleware/user.js](middleware/user.js) - User context injection via `x-cashly-user-*` headers with role-based access

**Data Flow**:
1. Request → User middleware (attachUserContext) → Route handler → Store/Square API
2. Stores use SQLite for local state (services, invoices, activity log, subscriptions, etc.)
3. Square API calls use idempotency keys (UUIDs) to prevent duplicate operations
4. Gift cards use in-memory cache + file-based persistence [util/gift-card-cache.js](util/gift-card-cache.js)

## Development Patterns

**Role-Based Access**: Defined in [middleware/user.js](middleware/user.js). Priority: viewer < analyst < finance < admin. Use `requireRole('finance')` middleware on protected routes.
```javascript
router.post('/admin/approve', requireRole('finance'), asyncHandler(handler));
// hasRole(user, 'analyst') returns true for analyst, finance, admin but false for viewer
```

**API Response Format**: Via [util/api-utils.js](util/api-utils.js)
```javascript
APIResponse.success(data, message) // {success: true, message, data, timestamp}
APIResponse.error(message, code, errors) // {success: false, message, code, errors, timestamp}
```

**Error Handling**: Wrap route handlers with `asyncHandler()` to catch promise rejections and pass to error middleware. Throw `APIError(message, statusCode, errors)` for structured responses. Always include `errors` array for validation/Square SDK failures:
```javascript
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
try {
  await invoicesApi.createInvoice(...);
} catch (err) {
  const details = err.errors?.map(e => e.detail) || [err.message];
  throw new APIError('Failed to create invoice', 400, details);
}
```

**Validation**: Use Joi schemas with `validateRequest(schema)` middleware. Schemas validate `req.body` by default:
```javascript
const createInvoiceSchema = Joi.object({
  customerId: Joi.string().trim().required(),
  locationId: Joi.string().trim().required(),
  items: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    quantity: Joi.number().required(),
  })).required(),
});
router.post('/', validateRequest(createInvoiceSchema), asyncHandler(handler));
```

**Database Operations**: Always use prepared statements via `db.prepare(sql).run()` or `.all()` from [util/db.js](util/db.js). Never concatenate SQL strings. SQLite WAL mode is enabled via pragma for concurrent access:
```javascript
const stmt = db.prepare('INSERT INTO invoices (id, customer_id, amount) VALUES (?, ?, ?)');
stmt.run(uuid(), customerId, amount);
const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
```

**Square Integration**: All API instances (customersApi, invoicesApi, cardsApi, etc.) are initialized in [util/square-client.js](util/square-client.js). Environment: `process.env.SQUARE_ENVIRONMENT` (sandbox or production). Token: `process.env.SQUARE_ACCESS_TOKEN`. Always handle Square SDK error structure:
```javascript
const { customersApi } = require('../util/square-client');
try {
  const { result } = await customersApi.createCustomer({
    idempotencyKey: uuid(),
    givenName: 'John',
  });
} catch (err) {
  // Square errors have err.errors[0].code (e.g., 'UNPROCESSABLE_ENTITY')
  if (err.errors?.[0]?.code === 'DUPLICATE_CUSTOMER_ID') { }
}
```

**Idempotency**: Pass `idempotencyKey` (min 10, max 64 chars, always UUID) to all Square mutations to ensure retry safety. Square caches responses per idempotency key for 24 hours:
```javascript
const idempotencyKey = crypto.randomUUID();
await invoicesApi.createInvoice({ idempotencyKey, invoice: {...} });
// Retry with same idempotencyKey returns same result, no duplicate charge
```

**Activity Logging**: Use [util/activity-store.js](util/activity-store.js) to record invoice state changes. Always include actor, type, and full payload for audit trails:
```javascript
activityStore.log({
  invoiceId: inv.id,
  type: 'INVOICE_SENT',
  payload: { recipient: email, sentAt: new Date() },
  actor: req.user.id,
});
```

## Critical Developer Workflows

**Local Development**:
```bash
npm install
# Create .env with SQUARE_ACCESS_TOKEN and SQUARE_ENVIRONMENT
npm run dev  # Starts on localhost:3000 with hot reload
```

**Database**: SQLite file at `./data/app.db` (or `$DB_FILE_PATH` env var). Schema auto-creates on startup via [util/db.js](util/db.js). Use `ensureColumn()` to add optional columns safely. WAL mode enabled for concurrent access:
```javascript
db.pragma("journal_mode = WAL");
// Allows multiple readers while one writer is active
```

**Linting**: `npm run lint` (ESLint configured) and `npm run lint:fix` to auto-format. ESLint config in workspace root checks for common errors.

**Testing**: `npm test` uses NODE_ENV=sandbox. Test setup in [jest.setup.js](jest.setup.js) mocks Square SDK methods. Requires `.env.test` file with Square credentials. Rate limiter set at 300 requests/15min—tests may hit this; adjust if needed.

**Deployment**: `npm run deploy:serverless` deploys Lambda via Serverless Framework. Database path defaults to `/tmp/app.db` in Lambda (ephemeral—must replace SQLite with managed DB like DynamoDB or RDS for production persistence). Handler wraps Express app via [handler.js](handler.js) using serverless-http.

**Middleware Chain** (in [app.js](app.js)):
1. `helmet()` - Security headers (CSP disabled to allow inline styles)
2. `compression()` - gzip responses
3. `rateLimit()` - 300 req/15min
4. `logger()` - Request logging
5. `bodyParser.json()` - Parse JSON (1MB limit)
6. `cookieParser()` - Cookie parsing
7. `static()` - Serve public files
8. `attachUserContext()` - Inject user from headers (FIRST business middleware)
9. Route handlers
10. `errorHandler()` - Global error catcher (catches APIError and bubbles to response)

Always add custom middleware before `attachUserContext` to avoid interference with user context.

## Project-Specific Conventions

**Feature Modules**: Each domain (invoice, estimate, subscription, gift-cards, payouts) gets its own route file in [routes/](routes/) and store in [util/](util/). Keep logic separated.

**No Direct Authentication**: The app trusts `x-cashly-user-*` headers (name, email, id, role) from an external auth service or reverse proxy. No JWT or password logic. Default user can be set via `DEFAULT_USER_*` env vars.

**Views & Templating**: Pug templates in [views/](views/). Always pass data via `res.locals`. Use `res.locals.currentPath` for active nav highlighting and `res.locals.currentUser` for permission checks in templates:
```javascript
res.locals.currentUser = req.user; // Automatically set by middleware
res.locals.currentPath = req.path;  // Automatically set by middleware
res.locals.permissions = { canManageGiftCards: hasRole(user, 'finance') };
```
In templates, check roles before rendering: `if currentUser.role === 'admin'` or use helper functions. Dark theme support via CSS toggle in [public/stylesheets/theme-switcher.css](public/stylesheets/theme-switcher.css).

**Gift Card Caching Strategy**: [util/gift-card-cache.js](util/gift-card-cache.js) maintains in-memory Map + file persistence (`data/gift-cards.json`). Background reconciliation runs via [util/gift-card-sync.js](util/gift-card-sync.js) on interval (`GIFT_CARD_RECONCILE_INTERVAL_MS`, default 1 day). Webhook handler triggers on-demand sync for real-time Square events:
```javascript
// Webhook event triggers immediate sync
await safeSync(giftCardId, { source: 'webhook', eventType: 'GIFT_CARD_ACTIVITY' });
// Background job reconciles all cards periodically
const reconcileAllCards = async () => {
  const cards = await fetchAllGiftCards();
  cards.forEach(card => giftCardCache.upsertCard(card));
};
// Manual API endpoint also available for admins
```

**Database Schema & Migrations**: Schema auto-creates on startup in [util/db.js](util/db.js) via `CREATE TABLE IF NOT EXISTS`. Add optional columns safely using `ensureColumn()` helper (never drops columns):
```javascript
// Safe pattern for adding new optional columns
ensureColumn('invoices', 'discount_percent', 'INTEGER DEFAULT 0');
ensureColumn('invoices', 'metadata', 'TEXT');
// This is idempotent and won't error if column already exists
```
To add required columns with defaults, create the column as nullable first, populate existing rows, then add NOT NULL constraint in separate release if needed. For schema-breaking changes, maintain backward compatibility by reading both old and new columns.

**Performance Middleware**: [middleware/performance.js](middleware/performance.js) adds timing headers. Always check before adding new middleware to avoid conflicts. Rate limiting: 300 requests per 15 minutes in [app.js](app.js)—adjust `requestLimiter` config if tests hit limits.

**Reminder Queue**: [util/reminder-queue.js](util/reminder-queue.js) manages invoice reminders via in-memory scheduling. Before adding new reminder types, ensure idempotency and check existing reminder logic for fire-once guarantees.

## Integration Points & External Dependencies

- **Square SDK**: All payments, invoices, customers, gift cards, payouts. Check Square API docs for method signatures.
- **Subscriptions**: Subscription logic in [routes/subscription.js](routes/subscription.js) ties to Square's subscription API.
- **Webhooks**: [routes/webhooks.js](routes/webhooks.js) handles incoming Square events. Validate signature using `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- **File Uploads**: [routes/uploads.js](routes/uploads.js) handles multer file middleware. Uploaded files stored in [public/uploads/](public/uploads/).
- **Analytics**: [routes/analytics.js](routes/analytics.js) queries SQLite for dashboard data (not external service).

## Common Task Patterns

**Adding a New Route**: 
1. Create [routes/feature.js](routes/feature.js), export router with feature-specific endpoints
2. Mount in [routes/index.js](routes/index.js): `router.use('/feature', featureRoute)`
3. Add corresponding store in [util/feature-store.js](util/feature-store.js) for persistence
4. Wrap handlers with `asyncHandler()` and use Joi validation middleware
5. Example from [routes/invoice.js](routes/invoice.js): Define schema, validate, call store/Square, log activity, return structured response

**Adding a Square API Call**: 
```javascript
const { invoicesApi } = require('../util/square-client');
const { v4: uuid } = require('uuid');
try {
  const { result } = await invoicesApi.createInvoice({
    idempotencyKey: uuid(), // ALWAYS include for mutations
    invoice: {
      id: uuid(),
      customerId: req.body.customerId,
      locationId: req.body.locationId,
      // ... invoice fields
    }
  });
  // Log success
  activityStore.log({ invoiceId: result.invoice.id, type: 'INVOICE_CREATED', actor: req.user.id });
  return APIResponse.success(result.invoice);
} catch (err) {
  // Extract Square error details
  const details = err.errors?.map(e => e.detail) || [err.message];
  throw new APIError('Failed to create invoice', 400, details);
}
```

**Updating Database Schema**: 
- Use `ensureColumn()` in [util/db.js](util/db.js) for optional columns (safe, idempotent):
```javascript
ensureColumn('invoices', 'new_column', 'TEXT DEFAULT NULL');
```
- For required columns or schema reorganization: create as nullable first, backfill data in separate step, then constraint in next release
- Never drop columns without versioning strategy—archive data to separate table first

**Adding Role-Based Routes**: Import `requireRole()` from [middleware/user.js](middleware/user.js) and chain it before route handler:
```javascript
const { requireRole } = require('../middleware/user');
router.post('/admin/approve', requireRole('finance'), asyncHandler(handler));
// Accessible by finance and admin roles only
```

**Webhook Handling**: In [routes/webhooks.js](routes/webhooks.js), validate Square signature first, then dispatch to appropriate handler:
```javascript
const signature = req.headers['x-square-hmac-sha256-signature'];
const body = req.rawBody; // Pre-computed raw body string
if (!isValidSquareSignature(signature, body, process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)) {
  return res.status(401).json({ error: 'Invalid signature' });
}
// Then handle event—example: gift card webhook triggers sync
const { type, data } = req.body;
if (type.startsWith('gift_card')) {
  await handleGiftCardWebhookEvent(type, data);
}
```

**File Uploads**: [routes/uploads.js](routes/uploads.js) handles multer file middleware. Files stored in [public/uploads/](public/uploads/). Always validate file type and size in middleware before storing.

## Files to Understand First

1. [app.js](app.js) - Middleware chain & app setup
2. [routes/index.js](routes/index.js) - Route mounting
3. [middleware/user.js](middleware/user.js) - Auth & role logic
4. [util/square-client.js](util/square-client.js) - Square API initialization
5. [util/db.js](util/db.js) - SQLite schema & initialization
6. [util/api-utils.js](util/api-utils.js) - Error & response handling
7. [package.json](package.json) - Dependencies & scripts

## Environment Variables

Required: `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`

Optional:
- `SQUARE_ENVIRONMENT`: sandbox or production (default: sandbox)
- `NODE_ENV`: development, production, or sandbox (affects logging, mocking)
- `DB_FILE_PATH`: Path to SQLite file (default: ./data/app.db)
- `DEFAULT_USER_*`: Fallback user context (DEFAULT_USER_NAME, DEFAULT_USER_EMAIL, DEFAULT_USER_ROLE)
- `GIFT_CARD_RECONCILE_INTERVAL_MS`: Background sync interval (default: 1 day)

## Critical Guardrails & Pitfalls

**Never Skip Idempotency Keys**: Every Square mutation (create, update, delete) MUST include `idempotencyKey` as a UUID. Square returns 400 if key is too short (<10) or long (>64). Without idempotency, retries after network failures cause duplicate charges, invoices, etc.

**Always Use Prepared Statements**: SQLite prepared statements via `db.prepare()` are REQUIRED. Template literals or string concatenation in SQL opens the database to injection attacks and will cause ESLint violations.

**Validate Request Before Processing**: `validateRequest(schema)` middleware must come BEFORE `asyncHandler()`. If validation fails, it throws APIError which is caught by error middleware, preventing downstream processing.

**Check User Context in Templates**: Templates have access to `currentUser` and `permissions`. Use these for permission checks:
```pug
if currentUser && hasRole(currentUser.role, 'finance')
  button(type='button').btn-danger Delete Invoice
```
If role check fails, never render sensitive actions even if backed by `requireRole()` on the server.

**Gift Card Sync Timing**: The background reconciliation job runs periodically. For real-time accuracy after webhook events, always call `await safeSync(giftCardId, { source: 'webhook' })` in webhook handler before responding. Don't rely solely on periodic reconciliation for user-facing operations.

**Rate Limit During Tests**: Default rate limiter is 300 req/15min. Tests with many parallel requests may hit this. Either adjust `requestLimiter` for NODE_ENV=sandbox or add test database isolation to reduce request volume.

**Error Response Structure**: Always return errors via `APIError()` which is caught by `errorHandler()`. Don't use `res.status().json()` directly for errors—ensures consistent error response format and logging.

**Webhook Signature Validation**: Always validate `x-square-hmac-sha256-signature` in [routes/webhooks.js](routes/webhooks.js) using the raw request body (not parsed JSON). Signature verification must happen BEFORE event processing to prevent spoofed events.

**Lambda Database Persistence**: Lambda function ephemeral storage at `/tmp` means SQLite data is lost between invocations. For production, replace SQLite with a persistent database (DynamoDB, RDS) and update connection logic in [util/db.js](util/db.js).
