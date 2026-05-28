import { Router } from 'express';
import { register, login, getMe, updateProfile } from '../controllers/authController.js';
import { getUniversities, getFeaturedUniversities, getFeaturedUniversitiesSlug } from '../controllers/universityController.js';
import { getScholarships, getRecommendedScholarships } from '../controllers/scholarshipController.js';
import { getDashboardSummary, getFavourites, addFavourite, deleteFavourite, getApplications } from '../controllers/dashboardController.js';
import { getAnalytics, createUniversity, updateUniversity, deleteUniversity, clearCache } from '../controllers/adminController.js';
import { authenticateJWT, requireAdmin } from '../middleware/auth.js';
import { rateLimitMiddleware, authRateLimitMiddleware } from '../middleware/rateLimit.js';
import { cacheMiddleware, inValidateCacheMiddleware } from '../middleware/cache.js';

const router = Router();

// ── Authentication & User Profiling ──
router.post('/auth/register', authRateLimitMiddleware, register);
router.post('/auth/login', authRateLimitMiddleware, login);
router.get('/users/me', authenticateJWT, getMe);
router.put('/users/me/profile', authenticateJWT, authRateLimitMiddleware, updateProfile);

// ── Universities ──
router.get('/universities', rateLimitMiddleware, getUniversities);
router.get('/universities/featured', rateLimitMiddleware, getFeaturedUniversities);
router.get('/universities/:slug', rateLimitMiddleware, getUniversityBySlug);

// ── Scholarships ──
router.get('/scholarships', rateLimitMiddleware, getScholarships);
router.get('/scholarships/recommended', authenticateJWT, rateLimitMiddleware, getRecommendedScholarships);

// ── Dashboard & User Actions ──
router.get('/dashboard/summary', authenticateJWT, rateLimitMiddleware, getDashboardSummary);
router.get('/favourites', authenticateJWT, rateLimitMiddleware, getFavourites);
router.post('/favourites', authenticateJWT, rateLimitMiddleware, addFavourite);
router.delete('/favourites/:id', authenticateJWT, rateLimitMiddleware, deleteFavourite);
router.get('/applications', authenticateJWT, rateLimitMiddleware, getApplications);

// ── Admin Portal (Requires ADMIN Role) ──
router.get('/admin/analytics', authenticateJWT, requireAdmin, rateLimitMiddleware, getAnalytics);
router.post('/admin/universities', authenticateJWT, requireAdmin, rateLimitMiddleware, createUniversity);
router.put('/admin/universities/:id', authenticateJWT, requireAdmin, rateLimitMiddleware, updateUniversity);
router.get('/universities', cacheMiddleware(15*60*1000), getUniversities);
router.get('/universities/featured', cacheMiddleware(15*60*1000), getFeaturedUniversitiesSlug);
router.get('/universities/partners', cacheMiddleware(15*60*1000), getFeaturedUniversities);
router.post('/universities/', authenticateJWT, requireAdmin, inValidateCacheMiddleware, createUniversity);
router.put('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, updateUniversity);
router.delete('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, deleteUniversity);

// —— Cache clearing ——
router.post('/admin/cache/clear', clearCache);

export default router;
