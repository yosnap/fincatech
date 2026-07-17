FROM node:22-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# node_modules de producción: el output de Nitro en .output/server ya trae sus propias
# dependencias empaquetadas y no las necesita, pero drizzle-kit (migración al arrancar,
# ver CMD) se ejecuta como CLI aparte y sí requiere sus propias dependencias instaladas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000

# Migra el esquema antes de arrancar el servidor — ver docs/deployment.md sobre por qué
# esto es seguro con un único replica pero no debe usarse con varios arrancando a la vez.
CMD ["sh", "-c", "pnpm exec drizzle-kit migrate && node .output/server/index.mjs"]
