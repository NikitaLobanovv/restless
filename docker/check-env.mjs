const e = process.env
let url
try {
  url = new URL(e.DATABASE_URL ?? '')
} catch {
  console.error('✗ .env: DATABASE_URL отсутствует или некорректен')
  process.exit(1)
}
const problems = []
if (decodeURIComponent(url.username) !== e.POSTGRES_USER) problems.push('пользователь (POSTGRES_USER)')
if (decodeURIComponent(url.password) !== e.POSTGRES_PASSWORD) problems.push('пароль (POSTGRES_PASSWORD)')
if (url.pathname.slice(1) !== e.POSTGRES_DB) problems.push('имя БД (POSTGRES_DB)')
if ((url.port || '5432') !== (e.POSTGRES_PORT || '5432')) problems.push('порт (POSTGRES_PORT)')
if (problems.length) {
  console.error(`✗ .env: в DATABASE_URL не совпадает ${problems.join(', ')}.`)
  console.error('  Приложение подключается по DATABASE_URL, контейнеры — по POSTGRES_*; значения должны совпадать.')
  console.error('  Пароль БД задаётся только при первом создании тома: после смены POSTGRES_PASSWORD')
  console.error('  смените его и в БД (make psql → ALTER USER ... PASSWORD ...) либо пересоздайте том (make reset).')
  process.exit(1)
}
