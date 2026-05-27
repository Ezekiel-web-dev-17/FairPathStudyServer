import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { logger } from '../utils/logger.js';
import { DATABASE_URL } from './config.js';

const connectionString = DATABASE_URL!;

// Create the pg connection pool
export const pool = new pg.Pool({ connectionString });

// Initialize the Prisma PG adapter
const adapter = new PrismaPg(pool);

// Create PrismaClient with the adapter (required in Prisma 7)
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

export const connectDB = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL database connected successfully via Prisma.');
  } catch (error) {
    logger.error('Database connection failed: %o', error);
  }
};
