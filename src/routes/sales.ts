import { Router } from 'express';
import { createSale, getSales, getSale } from '../controllers/sales.controller';
import { authenticate } from '../middleware/auth';
const router = Router();
router.use(authenticate);
router.post('/', createSale);
router.get('/', getSales);
router.get('/:id', getSale);
export default router;
