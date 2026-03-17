---
name: skill-router
description: "Автоматический роутер скиллов. Определяет тип задачи и загружает нужные SKILL.md из архива. Используй этот скилл ВСЕГДА когда пользователь просит 'используй скилы' или 'открой skills'."
---

# Skill Router — Автоматический выбор скиллов

**Базовый путь к архиву:** `/Users/osminkin/.gemini/antigravity/skills-archive/`
**Disabled скиллы:** `/Users/osminkin/.gemini/antigravity/skills_disabled/`

## Как работать

1. Определи тип задачи пользователя
2. Найди подходящую категорию ниже
3. Прочитай SKILL.md из КАЖДОГО 🔴-скилла через `view_file`
4. Прочитай 🟡-скиллы если задача затрагивает специфику
5. Примени все инструкции к работе

---

## 🍎 iOS / macOS / Apple (SwiftUI, UIKit, Xcode, Apple HIG, нативное приложение)

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | ios-developer | `skills-archive/ios-developer/SKILL.md` |
| 🔴 | swiftui-expert-skill | `skills-archive/swiftui-expert-skill/SKILL.md` |
| 🟡 | hig-project-context | `skills-archive/hig-project-context/SKILL.md` |
| 🟡 | hig-foundations | `skills-archive/hig-foundations/SKILL.md` |
| 🟡 | hig-platforms | `skills-archive/hig-platforms/SKILL.md` |
| 🟡 | hig-patterns | `skills-archive/hig-patterns/SKILL.md` |
| 🟢 | hig-technologies | `skills-archive/hig-technologies/SKILL.md` |
| 🟢 | hig-inputs | `skills-archive/hig-inputs/SKILL.md` |
| 🟢 | hig-components-* | `skills-archive/hig-components-controls/SKILL.md` и аналоги |

## 📱 Mobile / Кроссплатформа (Flutter, React Native, Expo)

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | mobile-design | `skills-archive/mobile-design/SKILL.md` |
| 🟡 | flutter-expert | `skills-archive/flutter-expert/SKILL.md` |
| 🟡 | react-native-architecture | `skills-archive/react-native-architecture/SKILL.md` |
| 🟢 | expo-dev-client | `skills-archive/expo-dev-client/SKILL.md` |

## 🌐 Fullstack / Веб-приложение (React, Next.js, Node.js, API, DB)

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | senior-fullstack | `skills-archive/senior-fullstack/SKILL.md` |
| 🔴 | full-stack-orchestration-full-stack-feature | `skills-archive/full-stack-orchestration-full-stack-feature/SKILL.md` |
| 🟡 | react-nextjs-development | `skills-archive/react-nextjs-development/SKILL.md` |
| 🟡 | nextjs-best-practices | `skills-archive/nextjs-best-practices/SKILL.md` |
| 🟡 | nodejs-backend-patterns | `skills-archive/nodejs-backend-patterns/SKILL.md` |
| 🟢 | postgresql | `skills-archive/postgresql/SKILL.md` |
| 🟢 | prisma-expert | `skills-archive/prisma-expert/SKILL.md` |

## 🎨 UI / UX / Дизайн

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | ui-ux-pro-max | `skills_disabled/ui-ux-pro-max/SKILL.md` |
| 🔴 | antigravity-design-expert | `skills_disabled/antigravity-design-expert/SKILL.md` |
| 🟡 | design-spells | `skills_disabled/design-spells/SKILL.md` |
| 🟡 | magic-ui-generator | `skills-archive/magic-ui-generator/SKILL.md` |
| 🟢 | kpi-dashboard-design | `skills-archive/kpi-dashboard-design/SKILL.md` |

## ✨ 3D / Анимации / VFX

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | threejs-skills | `skills-archive/threejs-skills/SKILL.md` |
| 🟡 | 3d-web-experience | `skills-archive/3d-web-experience/SKILL.md` |
| 🟡 | shader-programming-glsl | `skills-archive/shader-programming-glsl/SKILL.md` |
| 🟢 | scroll-experience | `skills-archive/scroll-experience/SKILL.md` |
| 🟢 | spline-3d-integration | `skills-archive/spline-3d-integration/SKILL.md` |

## ⚡ JavaScript / TypeScript

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | javascript-pro | `skills_disabled/javascript-pro/SKILL.md` |
| 🔴 | typescript-pro | `skills_disabled/typescript-pro/SKILL.md` |
| 🟡 | modern-javascript-patterns | `skills-archive/modern-javascript-patterns/SKILL.md` |

## 🤖 AI / ML / Agents

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | ai-agents-architect | `skills-archive/ai-agents-architect/SKILL.md` |
| 🟡 | llm-app-patterns | `skills-archive/llm-app-patterns/SKILL.md` |
| 🟡 | vercel-ai-sdk-expert | `skills-archive/vercel-ai-sdk-expert/SKILL.md` |
| 🟡 | gemini-api-integration | `skills-archive/gemini-api-integration/SKILL.md` |
| 🟢 | prompt-engineering | `skills-archive/prompt-engineering/SKILL.md` |
| 🟢 | langchain-architecture | `skills-archive/langchain-architecture/SKILL.md` |

## 🔧 Дебаг / Тесты / DevOps

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | debugger | `skills_disabled/debugger/SKILL.md` |
| 🔴 | bug-hunter | `skills-archive/bug-hunter/SKILL.md` |
| 🟡 | playwright-skill | `skills_disabled/playwright-skill/SKILL.md` |
| 🟡 | performance-optimization | `skills_disabled/performance-optimization/SKILL.md` |
| 🟡 | code-reviewer | `skills-archive/code-reviewer/SKILL.md` |
| 🟢 | docker-expert | `skills-archive/docker-expert/SKILL.md` |

## 🔑 Electron / Desktop App (ТЕКУЩИЙ ПРОЕКТ — Higgsfield Studio)

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🔴 | antigravity-design-expert | `skills_disabled/antigravity-design-expert/SKILL.md` |
| 🔴 | frontend-developer | `skills_disabled/frontend-developer/SKILL.md` |
| 🔴 | javascript-pro | `skills_disabled/javascript-pro/SKILL.md` |
| 🟡 | ui-ux-pro-max | `skills_disabled/ui-ux-pro-max/SKILL.md` |
| 🟡 | design-spells | `skills_disabled/design-spells/SKILL.md` |
| 🟡 | performance-optimization | `skills_disabled/performance-optimization/SKILL.md` |
| 🟡 | nodejs-best-practices | `skills_disabled/nodejs-best-practices/SKILL.md` |

## 📊 Бизнес / Стратегия

| 🔴🟡🟢 | Скилл | SKILL.md путь |
|---|---|---|
| 🟡 | steve-jobs | `skills-archive/steve-jobs/SKILL.md` |
| 🟡 | startup-analyst | `skills-archive/startup-analyst/SKILL.md` |
| 🟡 | product-manager | `skills-archive/product-manager/SKILL.md` |
| 🟡 | deep-research | `skills-archive/deep-research/SKILL.md` |
| 🟢 | marketing-psychology | `skills-archive/marketing-psychology/SKILL.md` |

---

## Приоритеты

- 🔴 **Обязательно загрузить** для данной категории
- 🟡 **Загрузить если задача конкретно про это**
- 🟢 **Загрузить только при прямом упоминании**

## Полный путь к SKILL.md

```
/Users/osminkin/.gemini/antigravity/{путь из таблицы}
```

Пример: `/Users/osminkin/.gemini/antigravity/skills-archive/ios-developer/SKILL.md`
