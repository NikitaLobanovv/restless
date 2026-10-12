# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — SemVer,
коммиты — [Conventional Commits](https://www.conventionalcommits.org/ru/).

## [Unreleased]

### Fixed

- build: `npm ci` скачивает бинарник Electron (`install-electron` в `postinstall`) — в Electron 44 он больше
  не загружается при установке, и `make up` падал с «Electron uninstall».
- build: `make migrate` печатает причину ошибки (например, неверный пароль) вместо немого `Ошибка 1`;
  `make` проверяет, что `DATABASE_URL` согласован с `POSTGRES_*` в `.env`.

### Added

- feat: составление запроса — стандартные и произвольные методы, URL с подсветкой `{{переменных}}`,
  двусторонняя синхронизация URL ↔ Query Params, заголовки, тела none/JSON/text/XML/urlencoded/multipart/binary,
  автоматический `Content-Type`, настройки таймаута, редиректов и проверки SSL.
- feat: отправка из main-процесса (undici) с отменой, Timeline (DNS/TCP/TLS/TTFB/загрузка), распаковкой gzip/deflate/br;
  панель ответа Pretty/Raw/Preview, заголовки, cookies, поиск, сворачивание JSON, копирование и сохранение в файл;
  ответы > 5 МБ — в Raw без подсветки.
- feat: вкладки с индикатором несохранённых изменений, восстановление после перезапуска и автосохранение каждые 5 с.
- feat: коллекции и вложенные папки, drag-and-drop, дублирование, поиск, переменные коллекции.
- feat: глобальные переменные и окружения, приоритет окружение → коллекция → глобальные,
  секретные переменные через `safeStorage`.
- feat: история (группировка по дням, повтор, сохранение в коллекцию, лимит 1000 с ротацией).
- feat: импорт cURL вставкой в поле URL, экспорт запроса как cURL с подтверждением для секретов.
- feat: темы (светлая/тёмная/системная), русский и английский интерфейс, нативное меню, горячие клавиши.
- feat: хранилище PostgreSQL 16 + Drizzle ORM, миграции, экран подключения при недоступной БД.
- build: Docker Compose (PostgreSQL, go-httpbin, ежедневные бэкапы), Makefile, electron-builder с Electron Fuses,
  автообновление из GitHub Releases (каналы stable/beta), CI на GitHub Actions.
- test: unit (Vitest + PGlite), интеграционные (PostgreSQL + echo-api + HTTPS с самоподписанным сертификатом),
  e2e (Playwright for Electron) для сценариев 1–5.
