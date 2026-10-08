FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps apps
COPY packages packages
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production SMTEL_PRODUCTION=true SMTEL_DEMO=false HOST=0.0.0.0
COPY --from=builder --chown=node:node /app /app
COPY --chown=node:node scripts scripts
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 4000
CMD ["npm", "start"]
