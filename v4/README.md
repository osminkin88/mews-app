# Mews v4 — Prototype

Отдельный design/prototype direction.  
**Production app не трогаем** — v4 живёт полностью изолированно.

## Запуск

Открой `index.html` в браузере — это карта всех экранов.  
Каждый экран можно открыть отдельно.

## Структура

```
v4/
├── index.html          ← карта экранов / навигатор
├── design-system.css   ← общие tokens, компоненты, topbar, statusbar
├── connection.html     ← подключение к серверу
├── projects.html       ← хаб проектов
├── settings.html       ← подготовка к запуску
├── progress.html       ← генерация в процессе
├── selection.html      ← отбор лучших вариантов
└── results.html        ← результаты / selected set
```

## Pipeline

```
Connection → Projects → Settings → Progress → Selection → Results → [v2: Animation]
```
