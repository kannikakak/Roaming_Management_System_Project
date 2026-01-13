import { Router } from 'express';
import path from "path";
import fs from "fs";
import multer from "multer";
import { register, login, getMe, updateProfile, changePassword, uploadProfileImage, deleteProfileImage } from '../controllers/authController';
import { Pool } from 'mysql2/promise';
import { requireAuth } from "../middleware/auth";

export const authRoutes = (dbPool: Pool) => {
  const router = Router();
  const uploadDir = path.join(process.cwd(), "uploads", "profile");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir });

  router.post('/register', register(dbPool));
  router.post('/login', login(dbPool));
  router.get('/me', requireAuth, getMe(dbPool));
  router.put('/profile', requireAuth, updateProfile(dbPool));
  router.put('/password', requireAuth, changePassword(dbPool));
  router.post('/profile-image', requireAuth, upload.single("image"), uploadProfileImage(dbPool));
  router.delete('/profile-image', requireAuth, deleteProfileImage(dbPool));
  return router;
};
