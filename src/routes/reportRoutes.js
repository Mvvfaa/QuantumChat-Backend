import { Router } from "express";
import rateLimit from "express-rate-limit";

import { createReport } from "../controllers/reportController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const reportLimiter = rateLimit({
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

router.post(
  "/",
  reportLimiter,
  requireAuth,
  createReport
);

export default router;