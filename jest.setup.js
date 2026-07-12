import { jest } from '@jest/globals';
import { prisma, pool } from './src/config/db.js';
import { redisClient } from './src/config/redis.js';

const originalWarn = console.warn;
jest.spyOn(console, 'warn').mockImplementation((msg, ...args) => {
    // Suppress specific Arcjet local IP warning
    if (typeof msg === 'string' && msg.includes('Arcjet will use 127.0.0.1')) {
        return;
    }
    // Let all other warnings through
    originalWarn(msg, ...args);
});

afterAll(async () => {
    try {
        await prisma.$disconnect();
    } catch {
        // Ignore disconnect errors
    }
    try {
        await pool.end();
    } catch {
        // Ignore pool end errors
    }
    try {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    } catch {
        // Ignore Redis quit errors
    }
});
