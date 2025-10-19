# Multi-stage Dockerfile for Paper Burner X

# Stage 1: Backend Build
FROM node:20-alpine AS backend-builder

WORKDIR /app/server

# Install OpenSSL for Prisma (Alpine 3.22 uses OpenSSL 3.x)
RUN apk add --no-cache openssl openssl-dev

# Copy backend package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy Prisma schema
COPY server/prisma ./prisma/

# Generate Prisma Client with binary target
RUN npx prisma generate

# Copy backend source
COPY server/src ./src/

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install dumb-init and OpenSSL for Prisma
RUN apk add --no-cache dumb-init openssl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy backend from builder
COPY --from=backend-builder --chown=nodejs:nodejs /app/server ./server/

# Copy frontend files
COPY --chown=nodejs:nodejs index.html ./
COPY --chown=nodejs:nodejs js ./js/
COPY --chown=nodejs:nodejs css ./css/
COPY --chown=nodejs:nodejs public ./public/
COPY --chown=nodejs:nodejs views ./views/
COPY --chown=nodejs:nodejs admin ./admin/

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if(r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/src/index.js"]
