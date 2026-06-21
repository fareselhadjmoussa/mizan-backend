import { Router } from 'express';
import { getFinanceSummary, resetFinance } from '../controllers/finance.controller';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/roles';

const router = Router();
router.use(authenticate);

router.get('/', getFinanceSummary);
router.post('/reset', adminOnly, resetFinance);

export default router;
