# PinToFB — полная документация системы

Автоматический постинг: **Pinterest (RSS) → Etsy-листинги → очередь → Facebook-страница SmartlyDigit**.

Собрано и работает на self-hosted n8n `2.90.0` (`https://n8ntestsrb.duckdns.org`).
Хранилище — n8n Data Tables (Postgres не нужен). Все воркфлоу в папке **PinToFB**.

Статус: **работает на автомате**, 6 постов в день в 09:00/11:00/13:00/15:00/17:00/20:00 (Europe/Belgrade).

---

## 1. Что делает система

```
Pinterest board RSS ──► A ──► pins ──► (резолв страницы пина) ──► items
                                                                   │
                                        boards.enabled ────────────┤
                                                                   ▼
                                                        B ──► schedule
                                                                   │
                                                                   ▼
                                               C ──► Facebook Page SmartlyDigit
                                                                   ▲
                                                        D ─────────┘ (управление вручную)
```

Поток: каждые 6 часов **A** читает RSS досок, достаёт из каждого пина ссылку на
Etsy, накапливает листинги. Каждое утро **B** раскладывает новые листинги по
слотам (без повторов, с ротацией досок). Каждые 30 минут **C** отдаёт
подошедшие посты в Facebook. **D** — ручное управление. **E** ловит падения.

Важно: **только A знает про Pinterest.** B/C/D работают с `items`/`schedule` по
ключу `etsy_listing_id`. Заменить источник на Etsy API потом = заменить только A.

---

## 2. Воркфлоу (папка PinToFB)

| Workflow | ID | Триггер | Статус | Что делает |
|---|---|---|---|---|
| **A - Sync Boards** | `fwvz0DCV8qUgISNJ` | каждые 6 ч + вручную | ON | RSS → pins → резолв → items |
| **B - Build Schedule** | `lquFp2VbnUQck4aw` | ежедневно 07:47 + вручную | ON | items → очередь с текстами |
| **C - Publisher** | `5e40Xz6KQgc6ihqp` | каждые 30 мин + вручную | ON | очередь → Facebook |
| **D - Control** | `3uORKvNDepdWOTBE` | n8n-форма | off (по запросу) | всё ручное управление |
| **E - Error Handler** | `PvlehC1HppyNUe9b` | при падении A–D | ON | пишет сбой в errors_log |
| 00 - Feed Probe | `km7kN1d4wZ12gUXV` | форма | off | диагностика одной доски |
| 01 - Pin Resolver Probe | `F4bacz8xycWyGkKx` | webhook | off | диагностика резолва ссылки |
| 02 - URL Check | `3npJ76d4byGKCXqJ` | webhook | off | что видит сервер по URL |
| 03 - Facebook Auth Check | `hUDLmGnurfQW3iSk` | webhook | off | работает ли FB-токен |
| 04 - FB Deep Check | `i9ytYfaimkRtVwbp` | webhook | off | права/страницы токена |

`02 - Capability Probe` (`5d2ji6dRpRApJr4V`) — устаревший черновик, можно удалить.

---

## 3. Хранилище (Data Tables)

| Таблица | ID | Что в ней |
|---|---|---|
| `boards` | `eHP9QfDm4Ay8F0HE` | доски (= категории), вкл/выкл, приоритет |
| `pins` | `HBshV0j15En0ZX6S` | кэш слоя-источника, одна строка на пин |
| `items` | `JaT1fvUeN6R77Pg2` | **одна строка на листинг Etsy** |
| `schedule` | `xKKcCos8oPqCFNDW` | очередь постинга, уникально по листингу |
| `config` | `Fzx5awBGnmaDaffF` | все настройки |
| `errors_log` | `VahesI6mpjXmcBX5` | отчёты прогонов и ошибки |

У Data Tables нет UNIQUE-ограничения — «листинг не ставится в очередь дважды»
обеспечивается логикой воркфлоу + атомарным захватом строки `queued → posting`.

### Статусы в `schedule`

```
queued     ждёт своего слота
posting    захвачен прогоном C прямо сейчас (защита от двойной публикации)
scheduled  принят Facebook, выйдет в scheduled_at
posted     опубликован
failed     попытка не удалась (error и attempts говорят что)
skipped    его доски выключены
```

`queued`, `posting`, `scheduled` — листинг считается занятым.
`failed`, `skipped` — ждут тебя (переставить через D).

---

## 4. Авторизация Facebook (как решили)

**Способ: System User token.** Это штатный путь для страницы, принадлежащей бизнесу.

- System User: **Johnadmin** (в бизнес-портфолио)
- Приложение Meta: **PagePost** (назначено Johnadmin, Full control)
- Страница: **SmartlyDigit** (`1378170695380729`, назначена Johnadmin, Full control)
- Токен: **бессрочный** (Never), с правами `pages_show_list`, `pages_manage_posts`,
  `pages_read_engagement`
- Хранится в n8n Credential **Facebook User Token** (`k62FLo1U37qyXxOk`),
  значение `Bearer <токен>`, Name = `Authorization`
- В `config`: `AUTH_MODE=token`

Почему не OAuth-логин: SmartlyDigit принадлежит бизнесу, и обычный логин
личного аккаунта её не отдавал, а новое приложение Meta блокировала за
автопостинг пачкой. System User обошёл обе проблемы и не истекает.

**Проверить токен в любой момент** (ничего не публикует):
запустить `03 - Facebook Auth Check` → должно быть `verdict: WORKING`,
страница SmartlyDigit.

**Если токен сломается** (его отозвали / убрали Johnadmin, страницу или
приложение в Business Settings; симптом — `code 190` в errors_log):
business.facebook.com → Business Settings → System Users → Johnadmin →
Generate new token → app PagePost → три права → Never → вставить в Credential
`Facebook User Token` как `Bearer <токен>`.

---

## 5. Настройки (`config`)

| Ключ | Значение сейчас | Смысл |
|---|---|---|
| `TIMEZONE` | `Europe/Belgrade` | все слоты в этом поясе |
| `SLOTS` | `09:00,11:00,13:00,15:00,17:00,20:00` | время постов (6/день) |
| `TEXT_MODE` | `pinterest` | текст из пина (без AI) |
| `EXTRA_HASHTAGS` | `#etsy #digitaldownload #smartlydigit` | добавляются, если в пине нет своих |
| `POST_TEXT_MAX_CHARS` | `600` | обрезка подписи по границе предложения |
| `REPOST_AFTER_DAYS` | `60` | повтор листинга не раньше этого; 0 = не повторять |
| `SCHEDULE_HORIZON_DAYS` | `14` | B не заполняет слоты дальше |
| `MAX_QUEUE_PER_RUN` | `60` | лимит новых строк за прогон B |
| `SYNC_INTERVAL_HOURS` | `6` | документирует триггер A |
| `PIN_RESOLVE_MAX_PER_RUN` | `10` | страниц пинов за прогон (каждая ~1 МБ) |
| `RESOLVE_THROTTLE_MS` | `2000` | пауза между запросами страниц |
| `RESOLVE_MAX_ATTEMPTS` | `3` | потом пин паркуется как failed |
| `RETRY_DELAY_MINUTES` | `30` | пауза перед повтором упавшего поста (один раз) |
| `MAX_PUBLISH_PER_RUN` | `6` | лимит вызовов Facebook за прогон C |
| `AUTH_MODE` | `token` | режим авторизации (System User token) |
| `DRY_RUN` | `false` | true = C ничего не шлёт, только логирует |
| `FB_PAGE_ID` | (пусто) | не нужен — страница берётся из токена |
| `FB_API_VERSION` | `v21.0` | версия Graph API |

Секреты — только в n8n Credentials. В `config` токенов нет.

---

## 6. Эксплуатация

### Ежедневно — ничего. Система работает сама.

### Раз в неделю
`D - Control → Execute → Queue for the next 7 days` — держится ли очередь.
Приход ~7 пинов/день против 6 постов — должно хватать. Тает — пинь больше
или добавь доску.

### Добавить доску Pinterest
`D → Board: add a new one` → вставить URL доски (RSS построится сам). Доска
добавляется **выключенной** (копит пины). Потом `A` раз синхронизировать и
`D → Board: enable`.

### Включить/выключить доску
`D → Board: enable` / `Board: disable` + слаг. `enabled` управляет только
публикацией, сбор идёт всегда. Выключение переводит её посты в `skipped`
(только те, у чьих листингов нет других включённых досок); включение — обратно.

### Проверить листинг
`D → Check a listing` + Etsy-URL или ID. Ответ: «уже запланирован на…»,
«опубликован…», «не запланирован» и т.д.

### Переставить / удалить пост
`D → Entry: reschedule` (ID из очереди + новое время) или `Entry: remove`.
Пост со статусом `scheduled` уже у Facebook — его через D **не сдвинуть**,
только в Meta Business Suite.

### Сменить время / число постов
`config → SLOTS`. Применится к тому, что B поставит дальше. Чтобы переложить
уже стоящую очередь на новую сетку:
```bash
node scripts/respread-queue.js          # посмотреть
node scripts/respread-queue.js --apply  # применить
```

### Пауза / возобновление
Выключить **C - Publisher** — публикация стоит, сбор идёт. Включить обратно —
догонит.

---

## 7. Что контролировать

Единственный симптом проблемы — в таблице **`errors_log`** (свежие сверху):
- `info` — обычный отчёт прогона
- `warn` — что-то пропущено с объяснением
- `error` — сбой публикации или падение

Упавший пост повторяется один раз через 30 минут, потом паркуется как
`failed`. Вернуть: `D → Entry: reschedule`.

Токен бессрочный — регулярной задачи с продлением нет.

---

## 8. Ручной режим (запасной)

Если автопостинг когда-то встанет (например, Facebook снова ограничит),
готовые посты можно вставлять руками — вся автоматика подготовки работает:
```bash
node scripts/todays-posts.js        # посты на сегодня
node scripts/todays-posts.js 1      # на завтра
```
Текст, проверенная картинка в полном разрешении и время — всё готово для
вставки в Meta Business Suite.

---

## 9. Разработка

```bash
# юнит-тесты (без сети и n8n, 181+ кейсов)
for f in pin-parser board-url pin-resolver scheduler post-text publisher control; do
  node src/$f.test.js
done

# пересобрать исходники Code-нод из src/ после правок
node scripts/build-code-nodes.js

# пересобрать воркфлоу и залить в n8n (create-or-update по имени)
node scripts/wf-a-sync-boards.js && node scripts/deploy.js workflows/A-sync-boards.json
```

**Нельзя править руками** `build/` и `workflows/` — они генерируются из `src/`
и `scripts/wf-*`. Смысл: код под тестами и код в n8n не могут разойтись.

### Структура
```
src/            логика + тесты рядом
  pin-parser      RSS → title/описание/картинка/Etsy-ссылка   (22 теста)
  board-url       ввод → username/slug/rss_url                (22)
  pin-resolver    HTML страницы пина → листинг Etsy           (15)
  scheduler       слоты, таймзона, DST, правила очереди       (37)
  post-text       сборка подписи, дедуп, обрезка              (23)
  publisher       отбор к публикации, scheduled vs immediate  (24)
  control         вьюхи и действия Workflow D                 (38)
  nodes/          n8n-обвязка каждой Code-ноды
scripts/        генераторы, deploy, диагностика
build/          сгенерированные исходники Code-нод — не править
workflows/      сгенерированный JSON воркфлоу
docs/           эта документация и гайды по Facebook-токену
```

---

## 10. История: что было нетривиально

1. **Pinterest RSS не содержит ссылку на Etsy** (проверено: 26 пинов, 0 ссылок).
   `<link>` и `<guid>` — это страница пина. Поэтому A открывает страницу пина
   и достаёт ссылку из встроенного JSON, кэшируя результат в `pins`.
2. **Картинки**: `/originals/*.jpg` часто 403, но `/originals/*.png` — настоящий
   оригинал (~850 КБ). Выбор картинки проверяет лестницу HEAD-запросами.
3. **Data Tables без UNIQUE** — уникальность листинга держится логикой + атомарным
   захватом строки.
4. **Facebook**: страница принадлежит бизнесу → обычный OAuth-логин её не отдавал,
   новое приложение Meta блокировала за автопостинг пачкой. Решение — **System
   User token** (бессрочный), штатный путь для бизнес-страниц.

---

_Репозиторий: ветка `claude/stoic-meitner-81d5bj`. Другие гайды в `docs/`:
`operating.md`, `facebook-page-token.md`, `setup-via-tunnel.md`._
