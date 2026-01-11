import { Router } from 'express';
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate
} from '../controllers/templateController';
import { dbPool } from '../db';

const router = Router();

router.post('/', createTemplate(dbPool));
router.get('/', getTemplates(dbPool));
router.get('/:id', getTemplateById(dbPool));
router.put('/:id', updateTemplate(dbPool));
router.delete('/:id', deleteTemplate(dbPool));

export default router;