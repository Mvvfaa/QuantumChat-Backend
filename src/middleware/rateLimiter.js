import rateLimit from "express-rate-limit";

// Blunt brute-force/credential-stuffing attempts against auth endpoints
// without affecting normal chat traffic.
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  message: {
    success: false,
    error: "Too many attempts, please try again shortly",
  },
});

/** General authenticated API limiter (CodeQL missing-rate-limiting). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests, please try again shortly",
  },
});

/**
 * Dedicated budget for realtime message polling. This route mounts after
 * requireAuth, so key by user rather than IP to avoid users behind one NAT
 * consuming each other's polling allowance.
 */
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.user._id),
  message: {
    success: false,
    error: "Too many sync requests, please try again shortly",
  },
});

/**
 * IP-keyed gate in front of requireAuth so CodeQL sees rate limiting on the
 * auth/DB lookup. The ceiling is high on purpose: two callers behind one NAT
 * must not share a tight IP budget (that 429'd ICE and stuck calls). The
 * real per-user cap is callSignalLimiter, applied after requireAuth.
 */
export const callSignalGatewayLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  message: { success: false, error: "Too many call signaling requests" },
});

/**
 * Separate budget for short-lived encrypted call signaling polling.
 *
 * Keyed by user, not IP — same reasoning as syncLimiter. Two people calling
 * each other from one household/office share an IP, and each client both
 * polls (~67 req/min at the 900ms interval) and POSTs a signal per ICE
 * candidate. An IP-keyed budget made them eat each other's allowance, so
 * setup got far enough to exchange offer/answer and then 429'd on the ICE
 * candidates — leaving the call stuck on "connecting" forever.
 *
 * The limit covers steady-state polling plus a trickle-ICE burst (a peer with
 * several interfaces / IPv6 can emit 20-30 candidates) with room for a retry.
 * Requires requireAuth to run first so req.user exists.
 */
export const callSignalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.user._id),
  message: { success: false, error: "Too many call signaling requests" },
});

/** Stricter budget for email/phone friend lookup (enumeration risk). */
export const contactLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: {
    success: false,
    error: "Too many contact lookups, please try again shortly",
  },
});

/**
 * Keeps a single account from firing off a burst of reports against many
 * different people in a short window — complements Report's unique
 * (reporter, reportedUser) index, which only stops repeat-reporting the
 * SAME target.
 */
export const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: {
    success: false,
    error: "Too many reports submitted, please try again later",
  },
});
/** Strict budget for vault password attempts — brute-force risk, same reasoning as authLimiter. */
export const vaultAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: {
    success: false,
    error: "Too many vault password attempts, please try again shortly",
  },
});

/** Public budget for device-link endpoints (verify/status/claim) keyed by IP. */
export const deviceLinkPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  keyGenerator: (req) => String(req.ip),
  message: { success: false, error: "Too many device-link requests, please try again shortly" },
});
