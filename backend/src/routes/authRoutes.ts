import { Router } from 'express';
import path from "path";
import fs from "fs";
import multer from "multer";
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  updateProfile,
  changePassword,
  uploadProfileImage,
  deleteProfileImage,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactorLogin,
  startMicrosoftLogin,
  handleMicrosoftCallback,
} from '../controllers/authController';
import { Pool } from 'mysql2/promise';
import { requireAuth } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";

export const authRoutes = (dbPool: Pool) => {
  const router = Router();
  const uploadDir = path.join(process.cwd(), "uploads", "profile");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir });
  const authLimiter = createRateLimiter({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
    keyBy: "ip",
    scope: "auth",
    message: "Too many authentication attempts. Please try again later.",
  });

  router.post('/register', authLimiter, register(dbPool));
  router.post('/login', authLimiter, login(dbPool));
  router.post('/refresh', authLimiter, refreshToken(dbPool));
  router.post('/logout', authLimiter, logout(dbPool));
  router.get('/microsoft/login', authLimiter, startMicrosoftLogin());
  router.get('/microsoft/callback', handleMicrosoftCallback(dbPool));
  router.post('/2fa/verify', authLimiter, verifyTwoFactorLogin(dbPool));
  router.get('/me', requireAuth, getMe(dbPool));
  router.put('/profile', requireAuth, updateProfile(dbPool));
  router.put('/password', requireAuth, changePassword(dbPool));
  router.post('/profile-image', requireAuth, upload.single("image"), uploadProfileImage(dbPool));
  router.delete('/profile-image', requireAuth, deleteProfileImage(dbPool));
  router.post('/2fa/setup', requireAuth, setupTwoFactor(dbPool));
  router.post('/2fa/enable', requireAuth, enableTwoFactor(dbPool));
  router.post('/2fa/disable', requireAuth, disableTwoFactor(dbPool));
  return router;
};
