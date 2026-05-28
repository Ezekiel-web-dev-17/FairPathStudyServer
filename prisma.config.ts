import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import process from 'node:process';

let envPath = '.env.development.local';
if (process.env.NODE_ENV === 'production') {
  envPath = '.env.production.local';
} else if (process.env.NODE_ENV === 'test') {
  envPath = '.env.test.local';
}

config({ path: envPath });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
