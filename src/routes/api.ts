import { Router } from 'express';
import { register, login, getMe, updateProfile } from '../controllers/authController.js';
import { getUniversities, getFeaturedUniversities, getUniversityBySlug } from '../controllers/universityController.js';
import { getScholarships, getRecommendedScholarships } from '../controllers/scholarshipController.js';
import { getDashboardSummary, getFavourites, addFavourite, deleteFavourite, getApplications } from '../controllers/dashboardController.js';
import { getAnalytics, createUniversity, updateUniversity } from '../controllers/adminController.js';
import { authenticateJWT, requireAdmin } from '../middleware/auth.js';

const router = Router();

// ── Authentication & User Profiling ──
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/users/me', authenticateJWT, getMe);
router.put('/users/me/profile', authenticateJWT, updateProfile);

// ── Universities ──
router.get('/universities', getUniversities);
router.get('/universities/featured', getFeaturedUniversities);
router.get('/universities/:slug', getUniversityBySlug);

// ── Scholarships ──
router.get('/scholarships', getScholarships);
router.get('/scholarships/recommended', authenticateJWT, getRecommendedScholarships);

// ── Dashboard & User Actions ──
router.get('/dashboard/summary', authenticateJWT, getDashboardSummary);
router.get('/favourites', authenticateJWT, getFavourites);
router.post('/favourites', authenticateJWT, addFavourite);
router.delete('/favourites/:id', authenticateJWT, deleteFavourite);
router.get('/applications', authenticateJWT, getApplications);

// ── Admin Portal (Requires ADMIN Role) ──
router.get('/admin/analytics', authenticateJWT, requireAdmin, getAnalytics);
router.post('/admin/universities', authenticateJWT, requireAdmin, createUniversity);
router.put('/admin/universities/:id', authenticateJWT, requireAdmin, updateUniversity);

export default router;
