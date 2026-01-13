import { Router } from 'express';
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate
} from '../controllers/templateController';
import { dbPool } from '../db';
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.post('/', requireRole(["admin", "analyst"]), createTemplate(dbPool));
router.get('/', getTemplates(dbPool));
router.get('/:id', getTemplateById(dbPool));
router.put('/:id', requireRole(["admin", "analyst"]), updateTemplate(dbPool));
router.delete('/:id', requireRole(["admin"]), deleteTemplate(dbPool));

export default router;
