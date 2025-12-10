// Application Configuration

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || "development",
    corsOrigin: process.env.CORS_ORIGIN || "*",
  },

  // Square API Configuration
  square: {
    environment: process.env.SQUARE_ENVIRONMENT || "sandbox",
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    locationId: process.env.SQUARE_LOCATION_ID,
  },

  // Security Configuration
  security: {
    rateLimitWindow: 15 * 60 * 1000, // 15 minutes
    rateLimitMax: 100, // requests per window
    sessionSecret: process.env.SESSION_SECRET || "your-secret-key",
    jwtSecret: process.env.JWT_SECRET || "your-jwt-secret",
  },

  // Cache Configuration
  cache: {
    staticMaxAge: "1d",
    enableEtag: true,
    enableLastModified: true,
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10,
    },
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.NODE_ENV === "production" ? "combined" : "dev",
  },

  // Feature Flags
  features: {
    enableCache: true,
    enableRateLimit: true,
    enableCompression: true,
    enableHelmet: true,
  },
};
