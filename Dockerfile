# ── Stage 1: Build ──
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package descriptors and prisma schema
COPY package*.json tsconfig.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for compiling)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and build TypeScript to JS
COPY src ./src
RUN npm run build

# ── Stage 2: Production Runner ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy package descriptors and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies (no typescript, jest, etc.)
RUN npm ci --only=production

# Re-generate Prisma Client for production env
RUN npx prisma generate

# Copy the compiled JS files from stage 1
COPY --from=builder /app/dist ./dist

# Clean up npm cache to save space
RUN npm cache clean --force

EXPOSE 5000
CMD ["npm", "start"]
