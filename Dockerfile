# ---- build stage ----
FROM node:24-alpine AS build
WORKDIR /usr/src/app

# Install deps (including dev deps for TypeScript build)
COPY package*.json ./
RUN npm ci

# Copy source + build
COPY tsconfig.json ./
COPY src ./src
COPY views ./views
COPY public ./public
RUN npm run build

# ---- runtime stage ----
FROM node:24-alpine
WORKDIR /usr/src/app
ENV NODE_ENV=production

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled app + templates/static assets
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/views ./views
COPY --from=build /usr/src/app/public ./public

# Persist config + schedule
VOLUME ["/usr/src/app/data"]

# The app listens on 3000 by default
EXPOSE 3000

# Optional: simple health check endpoint you already have
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "dist/server.js"]
