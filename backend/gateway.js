/**
 * API Gateway Layer - Redis-Backed Token-Bucket Rate Limiter
 * 
 * Algorithm:
 * - Tokens refill at a continuous rate (refillRatePerSec).
 * - Maximum tokens capped at bucket capacity.
 * - An atomic Lua script executes inside Redis to ensure thread-safety
 *   under high-concurrency bursts.
 */

// Atomic Lua Script for Token Bucket
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

-- Get current bucket state: [tokens, last_updated_timestamp]
local data = redis.call("HMGET", key, "tokens", "last_updated")
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if tokens == nil then
  -- First request: initialize bucket with full capacity
  tokens = capacity
  last_updated = now
else
  -- Calculate tokens refilled since last request
  local elapsed = math.max(0, (now - last_updated) / 1000)
  tokens = math.min(capacity, tokens + (elapsed * refill_rate))
  last_updated = now
end

-- Check if enough tokens exist
if tokens >= requested then
  tokens = tokens - requested
  redis.call("HMSET", key, "tokens", tokens, "last_updated", last_updated)
  -- Auto-expire key after 60 seconds of inactivity to save memory
  redis.call("EXPIRE", key, 60)
  return { 1, math.floor(tokens), 0 } -- [allowed=1, remaining, retry_after=0]
else
  -- Denied: calculate seconds until at least 1 token is refilled
  local needed = requested - tokens
  local retry_after = math.ceil(needed / refill_rate)
  redis.call("HMSET", key, "tokens", tokens, "last_updated", last_updated)
  redis.call("EXPIRE", key, 60)
  return { 0, math.floor(tokens), retry_after } -- [allowed=0, remaining, retry_after]
end
`;

/**
 * Factory to create Gateway Rate Limiter Middleware
 * 
 * @param {Object} redisClient - Connected ioredis instance
 * @param {Object} options
 * @param {number} options.capacity - Maximum burst capacity
 * @param {number} options.refillRatePerSec - Tokens replenished per second
 * @param {string} options.prefix - Redis key prefix
 */
function createRateLimiter(redisClient, options = {}) {
  const capacity = options.capacity || 10;
  const refillRatePerSec = options.refillRatePerSec || 2;
  const prefix = options.prefix || "rl:gateway";

  return async function rateLimiterMiddleware(req, res, next) {
    try {
      // 1. Identify Client (Prefer authenticated userId, fallback to IP address)
      const identifier =
        req.body?.userId ||
        req.headers["x-user-id"] ||
        req.ip ||
        req.socket.remoteAddress ||
        "anonymous";

      const key = `${prefix}:${identifier}`;
      const nowMs = Date.now();

      // 2. Execute Atomic Token-Bucket check in Redis
      const result = await redisClient.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        capacity,
        refillRatePerSec,
        nowMs,
        1 // cost: 1 token per request
      );

      const allowed = Number(result[0]) === 1;
      const remaining = Number(result[1]);
      const retryAfter = Number(result[2]);

      // 3. Attach standard RFC Rate-Limiting Headers
      res.setHeader("X-RateLimit-Limit", capacity);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining));

      if (!allowed) {
        res.setHeader("Retry-After", Math.max(1, retryAfter));
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please throttle your booking requests.",
          retryAfterSeconds: Math.max(1, retryAfter),
        });
      }

      // Allowed -> proceed to controller
      next();
    } catch (err) {
      // Fail-Safe: If Redis rate-limiter has a network error, log and allow traffic
      console.error("[Gateway Warning] Rate limiter bypassed due to error:", err.message);
      next();
    }
  };
}

module.exports = {
  createRateLimiter,
};
