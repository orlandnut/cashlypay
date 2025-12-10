const { performance } = require("perf_hooks");

const performanceMonitor = (req, res, next) => {
  // Start timing
  const start = performance.now();

  // Add response hook
  res.on("finish", () => {
    const duration = performance.now() - start;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    console.log({
      type: "request_completed",
      method,
      path: originalUrl,
      statusCode,
      durationMs: duration.toFixed(2),
      timestamp: new Date().toISOString(),
    });

    // Alert on slow requests (>500ms)
    if (duration > 500) {
      console.warn({
        type: "slow_request",
        method,
        path: originalUrl,
        durationMs: duration.toFixed(2),
      });
    }
  });

  next();
};

// Memory usage monitoring
const memoryMonitor = (req, res, next) => {
  const used = process.memoryUsage();

  // Log if memory usage is high (>80% of heap)
  if (used.heapUsed / used.heapTotal > 0.8) {
    console.warn({
      type: "high_memory_usage",
      heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

// Request queue monitoring
let requestQueue = [];
const queueMonitor = (req, res, next) => {
  // Add request to queue
  const requestId = Date.now();
  requestQueue.push(requestId);

  // Remove from queue on completion
  res.on("finish", () => {
    requestQueue = requestQueue.filter((id) => id !== requestId);

    // Alert if queue is getting long
    if (requestQueue.length > 50) {
      console.warn({
        type: "high_request_queue",
        queueLength: requestQueue.length,
        timestamp: new Date().toISOString(),
      });
    }
  });

  next();
};

module.exports = {
  performanceMonitor,
  memoryMonitor,
  queueMonitor,
};
