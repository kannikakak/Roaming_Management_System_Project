import { Router } from 'express';
import { createAuditLog, getAuditLogs } from '../controllers/auditLogsController';

const router = Router();

router.post('/', createAuditLog);
router.get('/', getAuditLogs);

export default router;