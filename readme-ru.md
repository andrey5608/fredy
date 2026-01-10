<p align="center">

<a href="https://fredy.orange-coding.net/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/orangecoding/fredy/blob/master/doc/logo_white.png" width="400">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/orangecoding/fredy/blob/master/doc/logo.png" width="400">
  <img alt="Fredy Logo" src="https://github.com/orangecoding/fredy/blob/master/doc/logo.png">
</picture>
</a>
</p>

<p align="center">
  <a href="https://fredy.orange-coding.net/" target="_blank">Сайт</a>&nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://fredy-demo.orange-coding.net/" target="_blank">Демо</a>
</p>

<p align="center">
  <img src="https://github.com/orangecoding/fredy/actions/workflows/test.yml/badge.svg" alt="Tests" />
  <img src="https://github.com/orangecoding/fredy/actions/workflows/docker.yml/badge.svg" alt="Docker" />
  <img src="https://github.com/orangecoding/fredy/actions/workflows/check_source.yml/badge.svg" alt="Source" />
  <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Forangecoding%2Ffredy%2Ffredy&query=%24.downloadCount&label=Docker%20Pulls" alt="Docker Pulls" />
</p>

# Fredy 🏡 – Ваш саморазмещаемый поисковик недвижимости в Германии

Искать жильё в Германии долго и сложно. **Fredy** автоматизирует поиск: парсит **ImmoScout24, Immowelt, Immonet, eBay Kleinanzeigen, WG-Gesucht** и сразу уведомляет через **Slack, Telegram, Email, ntfy, Discord и другие**.

Современная архитектура обеспечивает **удобный Web UI**, дедупликацию объявлений между платформами и хранение результатов, чтобы вы не видели одно и то же дважды.

------------------------------------------------------------------------

## ✨ Ключевые возможности

- 🏠 Парсинг **ImmoScout24, Immowelt, Immonet, eBay Kleinanzeigen, WG-Gesucht**
- ⚡ Мгновенные уведомления: Slack, Telegram, Email (SendGrid, Mailjet), ntfy, Discord и др.
- 🔎 Использование **мобильного API ImmoScout** (reverse engineering)
- 🌍 Запуск где угодно: Docker, Node.js, self-hosted
- 🖥️ Интуитивный Web UI для управления поисками
- 🎯 Простой интерфейс для настройки
- 🔄 Дедупликация между площадками
- ⏱️ Настраиваемые интервалы поиска

------------------------------------------------------------------------

## 🤝 Спонсорство [![](https://img.shields.io/static/v1?label=Sponsor&message=❤&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/orangecoding)

Проект поддерживается в свободное время. Если он полезен — рассмотрите поддержку 💙

Fredy поддержан программой **JetBrains Open Source Support**.

------------------------------------------------------------------------

## 👨‍🏫 Демо

Попробуйте: [Fredy Demo](https://fredy-demo.orange-coding.net/)

------------------------------------------------------------------------

## 🚀 Быстрый старт

### Через Docker

> [!NOTE]
> Для запуска нужен `conf/config.json`. Можно взять готовый из репозитория: https://github.com/orangecoding/fredy/blob/master/conf/config.json

```bash
docker run -d --name fredy \
  -v fredy_conf:/conf \
  -v fredy_db:/db \
  -p 9998:9998 \
  ghcr.io/orangecoding/fredy:master
```

Логи:

```bash
docker logs fredy -f
```

### Ручной запуск (Node.js)

- Требование: **Node.js 22+**
- Установка и старт:

```bash
yarn
yarn run start:backend   # в одном терминале
yarn run start:frontend  # в другом терминале
```

👉 Откройте <http://localhost:9998>

### Unraid

Пользователи [Unraid](https://unraid.net/) могут установить Fredy из community store.

**Логин по умолчанию:**
- Username: `admin`
- Password: `admin`

------------------------------------------------------------------------

## 📸 Скриншоты

| Основной экран Fredy                        | Настройка задания                                   | Найденные объявления                         |
|---------------------------------------------|-----------------------------------------------------|----------------------------------------------|
| ![Fredy](doc/screenshot1.png)               | ![Job Config](doc/screenshot3.png)                  | ![Listings](doc/screenshot2.png)             |

------------------------------------------------------------------------

## 🧩 Ключевые понятия

### Provider 🌐

**Provider** — площадка недвижимости (ImmoScout24, Immowelt, Immonet, eBay Kleinanzeigen, WG-Gesucht).
При создании задания вставьте поисковый URL из площадки. ⚠️ Убедитесь, что сортировка по **дате**, чтобы получать самые свежие объявления.

### Adapter 📡

**Adapter** — канал уведомлений (Slack, Telegram, Email, ntfy, Discord и др.). У каждого своя конфигурация (API-ключи, вебхуки). Можно включить несколько адаптеров одновременно — новые объявления пойдут во все каналы.

### Job 📅

**Job** объединяет провайдеры и адаптеры. Пример: «Искать квартиры на ImmoScout24 + Immowelt и слать в Slack + Telegram». Задания запускаются автоматически по интервалу в `conf/config.json`.

------------------------------------------------------------------------

## Immoscout

Из-за антибот-мер Immoscout используется обратный инжиниринг их мобильного API. Детали: [reverse-engineered-immoscout.md](https://github.com/orangecoding/fredy/blob/master/reverse-engineered-immoscout.md).

## Analytics

Fredy бесплатен и таким останется. По желанию можно включить анонимную отправку статистики раз в 6 часов: активные адаптеры/провайдеры, ОС, архитектура, версия Node, язык. Данные помогают понимать, что чаще используют.

## 🛠️ Разработка

### Dev-режим

```bash
yarn run start:backend:dev
yarn run start:frontend:dev
```
Откройте приложение в браузере; порт фронтенда выводится в терминал.

### Тесты

```bash
yarn run test
```

------------------------------------------------------------------------

## 📐 Архитектура

```mermaid
flowchart TD
 subgraph Jobs["Jobs"]
        A1["Job 1"]
        A2["Job 2"]
        A3["Job 3"]
  end
 subgraph Providers["Providers"]
        C1["Provider 1"]
        C2["Provider 2"]
        C3["Provider 3"]
  end
 subgraph NotificationAdapters["Notification Adapters"]
        F1["Adapter 1"]
        F2["Adapter 2"]
  end

    A1 --> B["FredyPipelineExecutioner"]
    A2 --> B
    A3 --> B
    B --> C1 & C2 & C3
    C1 --> D["Similarity Check"]
    C2 --> D
    C3 --> D
    D --> E{"Duplicate?"}
    E -- No --> F1
    F1 --> F2
```

------------------------------------------------------------------------

## 👐 Участие

Спасибо всем контрибьюторам!

<a href="https://github.com/orangecoding/fredy/graphs/contributors"><img src="https://contrib.rocks/image?repo=orangecoding/fredy" /></a>

Руководство по вкладу: [CONTRIBUTING.md](https://github.com/orangecoding/fredy/blob/master/CONTRIBUTING.md).

------------------------------------------------------------------------

## ⭐ История звёзд

[![Star History Chart](https://api.star-history.com/svg?repos=orangecoding/fredy&type=Date)](https://www.star-history.com/#orangecoding/fredy&Date)
