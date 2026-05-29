import { Router } from 'express';
import { register, login, getMe, updateProfile, verifyEmail, unsubscribe, logout } from '../controllers/authController.js';
import { getUniversities, getFeaturedUniversities, getFeaturedUniversitiesSlug } from '../controllers/universityController.js';
import { getScholarships, getRecommendedScholarships } from '../controllers/scholarshipController.js';
import { getDashboardSummary, getFavourites, addFavourite, deleteFavourite, getApplications } from '../controllers/dashboardController.js';
import { getAnalytics, createUniversity, updateUniversity, deleteUniversity, clearCache } from '../controllers/adminController.js';
import { authenticateJWT, requireAdmin } from '../middleware/auth.js';
import { authRateLimitMiddleware } from '../middleware/rateLimit.js';
import { cacheMiddleware, inValidateCacheMiddleware } from '../middleware/cache.js';
import { getOnboarding, saveOnboarding } from '../controllers/onboardingController.js';

const router = Router();

// ── Authentication & User Profiling ──
router.post('/auth/register', authRateLimitMiddleware, register);
router.get('/auth/verify-email', verifyEmail);
router.get('/auth/unsubscribe', unsubscribe);
router.post('/auth/login', authRateLimitMiddleware, login);
router.post('/auth/logout', logout);
router.get('/users/me', authenticateJWT, getMe);
router.put('/users/me/profile', authenticateJWT, updateProfile);

// ── Universities ──
router.get('/universities', cacheMiddleware(15 * 60 * 1000), getUniversities);
router.get('/universities/featured', cacheMiddleware(15 * 60 * 1000), getFeaturedUniversitiesSlug);
router.get('/universities/partners', cacheMiddleware(15 * 60 * 1000), getFeaturedUniversities);
router.post('/universities/', authenticateJWT, requireAdmin, inValidateCacheMiddleware, createUniversity);
router.put('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, updateUniversity);
router.delete('/universities/:id', authenticateJWT, requireAdmin, inValidateCacheMiddleware, deleteUniversity);

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

// ── Onboarding ──
router.get('/onboarding', authenticateJWT, getOnboarding);
router.post('/onboarding', authenticateJWT, saveOnboarding);

// —— Cache clearing ——
router.post('/admin/cache/clear', authenticateJWT, requireAdmin, clearCache);

export default router;
