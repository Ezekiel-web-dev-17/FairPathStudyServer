import { Router } from 'express';
import { register, login, getMe, updateProfile } from '../controllers/authController.js';
import { getUniversities, getFeaturedUniversities, getFeaturedUniversitiesSlug } from '../controllers/universityController.js';
import { getScholarships, getRecommendedScholarships } from '../controllers/scholarshipController.js';
import { getDashboardSummary, getFavourites, addFavourite, deleteFavourite, getApplications } from '../controllers/dashboardController.js';
import { getAnalytics, createUniversity, updateUniversity, deleteUniversity, clearCache } from '../controllers/adminController.js';
import { authenticateJWT, requireAdmin } from '../middleware/auth.js';
import { cacheMiddleware, inValidateCacheMiddleware } from '../middleware/cache.js';

const router = Router();

// ── Authentication & User Profiling ──
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/users/me', authenticateJWT, getMe);
router.put('/users/me/profile', authenticateJWT, updateProfile);

// ── Universities ──
router.get('/universities', cacheMiddleware(15*60*1000), getUniversities);
router.get('/universities/featured', cacheMiddleware(15*60*1000), getFeaturedUniversitiesSlug);
router.get('/universities/partners', cacheMiddleware(15*60*1000), getFeaturedUniversities);
router.post('/universities/', authenticateJWT, requireAdmin, inValidateCacheMiddleware, createUniversity);
router.put('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, updateUniversity);
router.delete('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, deleteUniversity);

// ── Scholarships ──
router.get('/scholarships', cacheMiddleware(15*60*1000), getScholarships);
router.get('/scholarships/recommended', authenticateJWT, getRecommendedScholarships);

// ── Dashboard & User Actions ──
router.get('/dashboard/summary', authenticateJWT, getDashboardSummary);
router.get('/favourites', authenticateJWT, inValidateCacheMiddleware, getFavourites);
router.post('/favourites', authenticateJWT, inValidateCacheMiddleware, addFavourite);
router.delete('/favourites/:id', authenticateJWT, inValidateCacheMiddleware, deleteFavourite);
router.get('/applications', authenticateJWT, inValidateCacheMiddleware, getApplications);

// ── Admin Portal (Requires ADMIN Role) ──
router.get('/admin/analytics', authenticateJWT, requireAdmin, getAnalytics);
router.post('/admin/universities', authenticateJWT, requireAdmin, createUniversity);
router.put('/admin/universities/:id', authenticateJWT, requireAdmin, updateUniversity);
router.post('/admin/cache/clear', clearCache);

export default router;
