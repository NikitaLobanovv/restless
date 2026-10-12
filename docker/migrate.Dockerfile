FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: не скачивать бинарник Electron в контейнер миграций
RUN npm ci --ignore-scripts
COPY drizzle.config.ts ./
COPY src/main/db ./src/main/db
COPY src/shared ./src/shared
COPY drizzle ./drizzle
COPY docker/migrate.mjs ./migrate.mjs
# Тот же мигратор drizzle-orm, что использует приложение; в отличие от `drizzle-kit migrate`
# он не скрывает причину ошибки (например, неверный пароль)
CMD ["node", "migrate.mjs"]
