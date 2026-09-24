FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Prisma 7 loads datasource configuration while generating the client.
# This build-only URL is never contacted and is not copied into the runtime image.
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/build

RUN apk add --no-cache ca-certificates openssl \
  && corepack enable \
  && corepack prepare pnpm@11.23.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts

RUN pnpm --filter @efm/contracts build \
  && pnpm --filter @efm/api prisma:generate \
  && pnpm --filter @efm/api build \
  && pnpm --filter @efm/api --prod deploy --legacy /output/api

FROM node:24-alpine AS runtime

RUN apk add --no-cache ca-certificates openssl dumb-init

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /output/api ./

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
