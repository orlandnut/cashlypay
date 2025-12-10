// API Utilities

class APIResponse {
  static success(data, message = "Success") {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  static error(message, code = 500, errors = null) {
    return {
      success: false,
      message,
      code,
      errors,
      timestamp: new Date().toISOString(),
    };
  }
}

class APIError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.name = "APIError";
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      throw new APIError(
        "Validation Error",
        400,
        error.details.map((detail) => detail.message),
      );
    }
    next();
  };
};

const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (err instanceof APIError) {
    return res
      .status(err.statusCode)
      .json(APIResponse.error(err.message, err.statusCode, err.errors));
  }

  // Square API specific error handling
  if (err.statusCode && err.errors) {
    return res.status(err.statusCode).json(
      APIResponse.error(
        "Square API Error",
        err.statusCode,
        err.errors.map((e) => e.detail),
      ),
    );
  }

  // Default error response
  res.status(500).json(APIResponse.error("Internal Server Error", 500));
};

const notFoundHandler = (req, res) => {
  res.status(404).json(APIResponse.error("Resource not found", 404));
};

module.exports = {
  APIResponse,
  APIError,
  asyncHandler,
  validateRequest,
  errorHandler,
  notFoundHandler,
};
