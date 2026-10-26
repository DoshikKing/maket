# Развёртывание на сервере через Docker Compose

Нужны Docker Engine с BuildKit и Docker Compose v2. Production-стек отделён от локального `compose.yaml`: `compose.prod.yaml` запускает PostgreSQL 17, одноразовый сервис миграций и Next.js standalone. Приложение работает от пользователя `node`, без root. Node.js и npm на сервере устанавливать не нужно.

## Первый запуск

```bash
git clone https://github.com/DoshikKing/maket.git
cd maket
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Откройте `.env.production` в редакторе и заполните:

- `POSTGRES_HOST`, `POSTGRES_PORT`: адрес и порт PostgreSQL. В этом Compose — `db` и `5432`.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`: логин и пароль. Строка подключения формируется внутри приложения, специальные символы пароля кодируются автоматически. В `.env` заключайте пароль с `$`, `#` или пробелами в одинарные кавычки.
- `POSTGRES_DB`, `POSTGRES_SCHEMA`: база и схема; по умолчанию `maket` / `public`. Для схемы используйте строчные латинские буквы, цифры и `_` (до 63 символов). Миграции создают выбранную схему, ORM и raw SQL используют её одинаково.
- `APP_URL`: **только подпуть** — `/maket` или пустое значение для корня домена. Домен и протокол берутся из заголовков доверенного reverse proxy. Изменение подпути требует `up -d --build`: Next.js встраивает его в маршруты и JS при сборке. Смена домена пересборки не требует.
- `MAIL_WEBHOOK_URL` и `MAIL_WEBHOOK_TOKEN`: Необязательный HTTPS-сервис доставки почты. Контракт: POST JSON `{ "to", "subject", "text" }`, `Authorization: Bearer <token>`, успешный ответ 2xx. Для восстановления также задайте `PUBLIC_ORIGIN` — канонический HTTPS origin, например `https://example.com`, без подпути. Это защищает ссылки сброса от подмены входящего Host. При регистрации без почты все три поля оставьте пустыми. Для регистрации почта не нужна: используется код приглашения из логов контейнера. Без почты восстановление пароля недоступно.
- `APP_BIND` / `APP_PORT`: адрес и порт на сервере. По умолчанию `127.0.0.1:3000` для HTTPS-прокси на этом же сервере. PostgreSQL наружу не публикуется.

Запускать из корня репозитория:

```bash
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps -a
```

Compose сначала ждёт готовности БД, применяет SQL-миграции и только после их успешного завершения запускает приложение. Сервис `migrate` со статусом `Exited (0)` — нормальное состояние. Ошибка миграции блокирует запуск приложения; журнал:

```bash
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=100 migrate app
curl --fail http://127.0.0.1:3000/maket/api/health
```

`/api/health` возвращает 200 при доступной БД, 503 при недоступной; подробности и секреты не раскрываются. Healthcheck помечает состояние контейнера, а `restart: unless-stopped` перезапускает завершившийся процесс. Состояние unhealthy само по себе не перезапускает контейнер — подключите мониторинг к этому endpoint.

Настройте HTTPS reverse proxy на `http://127.0.0.1:3000`. Передавайте исходные `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto` и IP клиента. Для импорта диаграмм задайте лимит тела запроса не меньше 10 MB. Подпуть прокси должен совпадать с `APP_URL`; для `/maket` используйте фрагмент ниже. При пустом `APP_URL` endpoint готовности находится на `/api/health`. Если прокси находится в другом контейнере, подключите его к сети приложения и направьте запросы на `app:3000` вместо localhost.

Сборка не требует доступа к БД и не получает `.env.production`: файлы окружения исключены через `.dockerignore`. Постоянные данные находятся в Docker volume `maket-production_postgres_data`, а не внутри контейнера приложения.

## Nginx под `/maket`

В `.env.production` задайте `APP_URL=/maket`. Строка подключения PostgreSQL и полный URL сайта больше не нужны.

Добавьте внутрь существующего HTTPS-блока `server { ... }`:

```nginx
include /opt/maket/deploy/nginx/maket.conf;
```

Замените `/opt/maket` путём к вашему репозиторию. [Готовый фрагмент](../deploy/nginx/maket.conf) проксирует `/maket/` и перенаправляет `/maket` на `/maket/`. В `proxy_pass` намеренно нет завершающего `/`: префикс передаётся приложению целиком, `rewrite` и `sub_filter` не нужны. Для Nginx в Docker замените upstream `127.0.0.1:3000` на `app:3000` в общей сети.

```bash
docker compose --env-file .env.production -f compose.prod.yaml up -d --build --wait
sudo nginx -t
sudo systemctl reload nginx
```

После этого открывайте `https://ваш-домен/maket/`. Этот же префикс используется для API, ресурсов Next.js, публичных ссылок, регистрации и проверок готовности. При смене `APP_URL` пересоберите образ; при локальной разработке перезапустите `npm run dev`.

Для обновления старой `.env`: удалите `DATABASE_URL`, заполните поля `POSTGRES_*`, а прежний полный `APP_URL` замените подпутём или пустой строкой. Сохраните прежние имя базы, пользователя, пароль и схему: смена `POSTGRES_SCHEMA` выбирает другое пространство таблиц, а не переносит существующие данные. Старый `DATABASE_URL` поддерживается только для обратной совместимости и в новых шаблонах не используется.

## Регистрация по приглашению

При каждом запуске контейнера приложение создаёт один случайный код приглашения. После готовности HTTP-сервера и БД в логах появляется строка `[maket invite] <код>`. Миграционный контейнер код не создаёт.

```bash
docker compose --env-file .env.production -f compose.prod.yaml logs app | grep '\[maket invite\]' | tail -n 1
```

Передайте последний код приглашённым пользователям. На странице регистрации нужны имя, email (как логин), пароль и код. Письмо не отправляется: после регистрации можно сразу войти. Один код подходит для нескольких регистраций и не меняется при запросах или обновлении страниц. Код проверяется на сервере и не доступен через API или HTML страницы.

Перезапуск меняет код; прежний перестаёт действовать, уже созданные аккаунты и их пароли сохраняются:

```bash
docker compose --env-file .env.production -f compose.prod.yaml restart app
docker compose --env-file .env.production -f compose.prod.yaml logs --tail=50 app
```

В `.env.production` код не задаётся. `MAIL_WEBHOOK_URL` / `MAIL_WEBHOOK_TOKEN` нужны только для необязательного восстановления пароля. Доступ к коду получают владельцы логов; любой обладатель кода может зарегистрироваться. Для запуска вне Docker используйте `npm run dev` / `npm start`: они генерируют и выводят код таким же образом. При прямом запуске Next.js в обход стартового скрипта без кода регистрация закрыта (503).

Старый незавершённый аккаунт можно активировать повторной регистрацией с кодом и прежним паролем. Регистрация не заменяет пароль или имя существующего аккаунта. Ранее выданные ссылки подтверждения продолжают действовать до истечения срока.

## Создание аккаунта через CLI

При необходимости создать аккаунт с уже подтверждённой почтой используйте существующий CLI. В Bash пароль вводится скрыто и передаётся через stdin:

```bash
read -r -s -p 'Пароль аккаунта: ' MAKET_USER_PASSWORD
printf '\n'
printf '%s' "$MAKET_USER_PASSWORD" | docker compose --env-file .env.production -f compose.prod.yaml \
  run --rm -T app node scripts/create-test-user.mjs --email admin@example.com --name 'Администратор' --password-stdin
unset MAKET_USER_PASSWORD
```

Замените email на свой. Пароль — 10–128 символов. Пользователь получает собственную рабочую область; существующие аккаунты и их пароли команда не меняет. Обычная регистрация работает по коду приглашения; почта нужна только для необязательного восстановления пароля.

## Стандартные нотации

Блок-схема, BPMN и UML доступны всем пользователям автоматически при открытии раздела «Нотации» и выборе нотаций новой диаграммы. Отдельная ручная загрузка и seed-команда не нужны. Это общие неизменяемые шаблоны: для редактирования создайте копию. Их также можно экспортировать в JSON и импортировать как пользовательские нотации.

BPMN включает события, задачи, подпроцессы, шлюзы, участников, данные и три типа связей; UML — классы, интерфейсы, перечисления, акторов, варианты использования, компоненты, пакеты, узлы и шесть типов связей. Наборы используют механизм нотаций maket и его формы; импорт BPMN XML и UML XMI не добавляется. Старые диаграммы сохраняют собственные снимки нотаций, пользовательские нотации не заменяются.

## Обновление

Сначала сделайте резервную копию. Затем:

```bash
git pull --ff-only
docker compose --env-file .env.production -f compose.prod.yaml build
docker compose --env-file .env.production -f compose.prod.yaml stop app
docker compose --env-file .env.production -f compose.prod.yaml run --rm migrate
docker compose --env-file .env.production -f compose.prod.yaml up -d
```

Продолжайте к `up` только при успешной миграции. Повторное применение проверяет историю и пропускает уже применённые SQL-файлы. Обновление сохраняет volume БД. Для изменения почты или привязки HTTP-порта измените `.env.production` и выполните `up -d`: Compose пересоздаст контейнеры с новым окружением. `restart` не перечитывает `.env`. Для изменения `APP_URL` дополнительно требуется пересборка образа.

Пароль PostgreSQL фиксируется при первом создании volume. Изменение `POSTGRES_PASSWORD` в файле не меняет пароль существующей БД; его нужно менять согласованно в самой БД.

## Резервная копия и восстановление

```bash
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  sh -c 'pg_dump -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/maket.dump
```

Скопируйте backup с сервера в отдельное хранилище. Каталог `backups/` исключён из Git и Docker-контекста. Для восстановления выбранной копии (заменяет текущие данные):

```bash
docker compose --env-file .env.production -f compose.prod.yaml stop app
docker compose --env-file .env.production -f compose.prod.yaml exec -T db \
  sh -c 'pg_restore --exit-on-error --clean --if-exists -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/maket.dump
docker compose --env-file .env.production -f compose.prod.yaml up -d
```

Остановка без удаления данных:

```bash
docker compose --env-file .env.production -f compose.prod.yaml down
```

Не используйте `down -v` для рабочего стека: эта команда удаляет volume с БД.

## Существующая внешняя PostgreSQL

Для контейнера, подключённого к уже управляемой БД, Compose не обязателен:

```bash
docker build -t maket-app:local .
# В защищённом .env.external укажите POSTGRES_*, APP_URL и необязательные параметры почты.
# При подпути добавьте к docker build: --build-arg APP_URL=/maket
docker run --rm --env-file .env.external maket-app:local node scripts/migrate.mjs
docker run -d --name maket-app --restart unless-stopped --init \
  --env-file .env.external -p 127.0.0.1:3000:3000 maket-app:local
```

Если внешняя БД требует TLS, используйте `PGSSLMODE=verify-full` и настройте доверенный CA согласно требованиям сервера БД.
