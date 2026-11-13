# Pono in one image (D-024): the console on :3000, the only port exposed, and the API beside it on
# :8787, reached through the console's relay. Migrations run at start, as the owner role.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Read at build time by the console (D-017).
ARG VITE_UMAMI_WEBSITE_ID=""
ARG VITE_UMAMI_SCRIPT_URL=""
RUN pnpm --filter @pono/web build

ENV NODE_ENV=production PONO_API_PORT=8787 PONO_API_URL=http://127.0.0.1:8787
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]
