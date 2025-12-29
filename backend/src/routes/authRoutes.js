const express = require("express");
const { z } = require("zod");

const authController = require("../controllers/authController");
const { asyncHandler } = require("../middlewares/asyncHandler");
const { validate } = require("../middlewares/validate");
const { auth } = require("../middlewares/auth");
const { rateLimit } = require("../middlewares/rateLimit");

const router = express.Router();
router.use(express.json({ limit: "512kb" }));

const authLimiter = rateLimit({ windowMs: 60_000, max: 60 });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 20 });

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(1024),
  publicKey: z
    .string()
    .min(1)
    .max(256 * 1024),
  encryptedPrivateKey: z
    .string()
    .min(1)
    .max(256 * 1024),
  mac: z
    .string()
    .min(1)
    .max(4 * 1024),
  nonce: z
    .string()
    .min(1)
    .max(4 * 1024),
  salt: z
    .string()
    .min(1)
    .max(4 * 1024),
  iv: z
    .string()
    .min(1)
    .max(4 * 1024),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(1024),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});

router.post(
  "/register",
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register)
);

router.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login)
);

router.post(
  "/refresh",
  loginLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh)
);

router.post(
  "/logout",
  loginLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(authController.logout)
);

router.get("/me", auth, asyncHandler(authController.me));

module.exports = router;
