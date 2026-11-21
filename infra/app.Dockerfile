# One image for the web app, the worker, the voice agent and the migrations (byggplan step 9).
# The services differ only in their command (infra/docker-compose.yml). Built on the server by
# infra/scripts/deploy.sh from the repository root:
#   docker build -f infra/app.Dockerfile -t bojen-app .
FROM node:24.19.0-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# Next.js puts the NEXT_PUBLIC_ values into the browser code at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN pnpm --filter @bojen/web build

# Next.js writes its cache at runtime.
RUN chown -R node:node /app/apps/web/.next
ENV NODE_ENV=production
USER node
