# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-bookworm-slim

# ---- deps: full install (native build tools for node-pty) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: compile TypeScript ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- prod-deps: prune devDependencies (keeps compiled node-pty) ----
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---- runner ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_MIGRATIONS_RUN=true
# Interactive shell used by the web terminal feature.
ENV SHELL=/bin/bash
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:3001/ || exit 1
CMD ["node", "dist/main"]
