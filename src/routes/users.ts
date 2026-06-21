import { Router } from 'express';
import { getUsers, createUser, updateUser, deleteUser } from '../controllers/users.controller';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/roles';

const router = Router();

router.use(authenticate, adminOnly);  // All user routes: Admin only

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
