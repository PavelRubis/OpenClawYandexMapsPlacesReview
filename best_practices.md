# Лучшие практики разработки tool-плагинов для OpenClaw на Node.js + TypeScript

## Pattern 1: Используйте экосистему Node.js / TypeScript по максимуму

Не изобретайте решения для задач, которые уже решены стандартными возможностями Node.js, TypeScript или популярными npm-пакетами.

Используйте встроенные или общепринятые инструменты:

* `pino`, `winston` или встроенный `Logger` фреймворка вместо самодельного логгера.
* `zod`, `joi`, `class-validator` или `yup` для валидации входных данных.
* `passport`, `Auth.js`, JWT-библиотеки или готовые OAuth/OpenID Connect SDK вместо ручной реализации авторизации.
* `Prisma`, `TypeORM`, `Kysely` или `Drizzle ORM` вместо ручной сборки SQL там, где это не требуется.
* `BullMQ`, `RabbitMQ`, `KafkaJS` или другие готовые решения для фоновых задач и очередей.
* `node-config`, `dotenv`, `convict` или конфигурационный механизм фреймворка вместо самодельной работы с переменными окружения.

**Код "До":**

```ts
class ConsoleLogger {
  log(message: string): void {
    console.log(`[LOG] ${new Date().toISOString()}: ${message}`);
  }
}

class SearchRequestService {
  private readonly logger = new ConsoleLogger();

  createRequest(text: string): void {
    this.logger.log(`Создаем запрос: ${text}`);
    // ...
  }
}
```

**Код "После":**

```ts
import pino from "pino";

const logger = pino();

class SearchRequestService {
  createRequest(text: string): void {
    logger.info({ queryText: text }, "Создаем запрос");
    // ...
  }
}
```

---

## Pattern 2: Отделяйте OpenClaw tool adapter от поведения тула, DTO и инфраструктуры

В tool-plugin бизнес-логикой считается **поведение самого тула**: какие проверки он выполняет, какие зависимости вызывает, как интерпретирует результат и какой ответ возвращает модели.

При этом сам OpenClaw tool definition не должен превращаться в толстый `execute`.

Разделяйте код на несколько ролей:

* **`Tools/`** — тонкие OpenClaw adapters: `name`, `description`, `parameters`, `execute`.
* **`Application/ToolCallHandlers/`** — поведение тулов, то есть основная логика выполнения tool call.
* **`Application/Dependencies/`** — интерфейсы инфраструктурных зависимостей: API-клиенты, логгер, clock, storage, file system, queue и т.д.
* **`Application/Dtos/`** — DTO входа и выхода для tool call handlers.
* **`Infrastructure/`** — реализации зависимостей: HTTP-клиенты, SDK-адаптеры, файловая система, база данных, очереди, логирование.
* **`Composition/`** — сборка конкретных handler-ов и infrastructure adapters.
* **`Schemas/`** — TypeBox-схемы для OpenClaw config и parameters.
* **`Tests/`** — тесты.

Главное правило: `execute` должен быть тонким. Он принимает параметры от OpenClaw, создает DTO, вызывает handler и возвращает результат.

Поведение тула не должно напрямую зависеть от OpenClaw SDK, `fetch`, конкретного SDK внешнего сервиса, базы данных или файловой системы. Оно должно зависеть от интерфейсов из `Application/Dependencies`.

Рекомендуемая структура:

```txt id="q9k5mx"
src/
  index.ts

  Tools/
    jira-create-issue.tool.ts
    jira-search-issues.tool.ts

  Application/
    ToolCallHandlers/
      create-jira-issue-tool-call-handler.ts
      search-jira-issues-tool-call-handler.ts

    Dependencies/
      jira-issue-client.ts
      logger.ts
      clock.ts

    Dtos/
      create-jira-issue.dto.ts
      search-jira-issues.dto.ts

  Infrastructure/
    Jira/
      http-jira-issue-client.ts

    Logging/
      pino-logger.ts

  Composition/
    create-tool-call-handlers.ts

  Schemas/
    jira-config.schema.ts
    create-jira-issue-parameters.schema.ts
    search-jira-issues-parameters.schema.ts
  
  Tests/
    jira-create-issue.test.ts
```

Отдельно в корне пакета:

```txt id="mk8l3c"
openclaw.plugin.json
package.json
tsconfig.json
README.md
```

**Код "До":**

```ts id="g8f4wa"
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

export default defineToolPlugin({
  id: "jira-plugin",
  name: "Jira Plugin",
  description: "Adds Jira tools.",

  configSchema: Type.Object({
    baseUrl: Type.String(),
    token: Type.String(),
  }),

  tools: (tool) => [
    tool({
      name: "jira_create_issue",
      description: "Create a Jira issue.",

      parameters: Type.Object({
        projectKey: Type.String(),
        title: Type.String(),
        description: Type.Optional(Type.String()),
      }),

      async execute(params, config, context) {
        context.signal?.throwIfAborted();

        const response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
          method: "POST",
          signal: context.signal,
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              project: {
                key: params.projectKey,
              },
              summary: params.title,
              description: params.description,
              issuetype: {
                name: "Task",
              },
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Jira request failed with status ${response.status}`);
        }

        const json = await response.json();

        return {
          status: "created",
          issueKey: json.key,
          issueUrl: `${config.baseUrl}/browse/${json.key}`,
        };
      },
    }),
  ],
});
```

Проблемы:

* `execute` одновременно описывает OpenClaw tool, содержит поведение тула и знает детали Jira API.
* Поведение тула сложно тестировать без реального HTTP или моков `fetch`.
* Смена Jira SDK/API затронет OpenClaw tool definition.
* DTO не отделены от OpenClaw parameters.
* Инфраструктура протекает в поведение тула.
* Нарушается Dependency Inversion: высокоуровневое поведение зависит от низкоуровневого HTTP-вызова.

**Код "После":**

```ts id="zz21xk"
// src/Application/Dtos/create-jira-issue.dto.ts

export type CreateJiraIssueInputDto = {
  projectKey: string;
  title: string;
  description?: string;
};

export type CreateJiraIssueOutputDto = {
  status: "created";
  issueKey: string;
  issueUrl: string;
};
```

```ts id="bf1v46"
// src/Application/Dependencies/jira-issue-client.ts

import { CreateJiraIssueInputDto } from "../Dtos/create-jira-issue.dto";

export type CreatedJiraIssueDto = {
  key: string;
  url: string;
};

export interface JiraIssueClient {
  createIssue(
    input: CreateJiraIssueInputDto,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<CreatedJiraIssueDto>;
}
```

```ts id="hwthzt"
// src/Application/ToolCallHandlers/create-jira-issue-tool-call-handler.ts

import {
  CreateJiraIssueInputDto,
  CreateJiraIssueOutputDto,
} from "../Dtos/create-jira-issue.dto";
import { JiraIssueClient } from "../Dependencies/jira-issue-client";

export class CreateJiraIssueToolCallHandler {
  constructor(private readonly jiraIssueClient: JiraIssueClient) {}

  async handle(
    input: CreateJiraIssueInputDto,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<CreateJiraIssueOutputDto> {
    if (!input.projectKey.trim()) {
      throw new Error("Project key must not be empty.");
    }

    if (!input.title.trim()) {
      throw new Error("Issue title must not be empty.");
    }

    const issue = await this.jiraIssueClient.createIssue(input, {
      signal: options?.signal,
    });

    return {
      status: "created",
      issueKey: issue.key,
      issueUrl: issue.url,
    };
  }
}
```

```ts id="jy2ko1"
// src/Infrastructure/Jira/http-jira-issue-client.ts

import { CreateJiraIssueInputDto } from "../../Application/Dtos/create-jira-issue.dto";
import {
  CreatedJiraIssueDto,
  JiraIssueClient,
} from "../../Application/Dependencies/jira-issue-client";

export type HttpJiraIssueClientOptions = {
  baseUrl: string;
  token: string;
};

export class HttpJiraIssueClient implements JiraIssueClient {
  constructor(private readonly options: HttpJiraIssueClientOptions) {}

  async createIssue(
    input: CreateJiraIssueInputDto,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<CreatedJiraIssueDto> {
    const response = await fetch(`${this.options.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      signal: options?.signal,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: {
            key: input.projectKey,
          },
          summary: input.title,
          description: input.description,
          issuetype: {
            name: "Task",
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Jira request failed with status ${response.status}`);
    }

    const json = await response.json();

    return {
      key: json.key,
      url: `${this.options.baseUrl}/browse/${json.key}`,
    };
  }
}
```

```ts id="b6zwj6"
// src/Schemas/create-jira-issue-parameters.schema.ts

import { Type } from "typebox";

export const createJiraIssueParametersSchema = Type.Object({
  projectKey: Type.String({
    description: "Jira project key, for example BACKEND.",
  }),
  title: Type.String({
    description: "Issue title.",
  }),
  description: Type.Optional(
    Type.String({
      description: "Issue description.",
    })
  ),
});
```

```ts id="l192ng"
// src/Schemas/jira-config.schema.ts

import { Type } from "typebox";

export const jiraConfigSchema = Type.Object({
  baseUrl: Type.String({
    description: "Jira base URL.",
  }),
  token: Type.String({
    description: "Jira API token.",
  }),
});
```

```ts id="cgs1k6"
// src/Composition/create-tool-call-handlers.ts

import { CreateJiraIssueToolCallHandler } from "../Application/ToolCallHandlers/create-jira-issue-tool-call-handler";
import { HttpJiraIssueClient } from "../Infrastructure/Jira/http-jira-issue-client";

export type PluginConfig = {
  baseUrl: string;
  token: string;
};

export function createToolCallHandlers(config: PluginConfig) {
  const jiraIssueClient = new HttpJiraIssueClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  return {
    createJiraIssue: new CreateJiraIssueToolCallHandler(jiraIssueClient),
  };
}
```

```ts id="zme1x2"
// src/Tools/jira-create-issue.tool.ts

import { createJiraIssueParametersSchema } from "../Schemas/create-jira-issue-parameters.schema";
import { createToolCallHandlers } from "../Composition/create-tool-call-handlers";

export function createJiraIssueTool(tool: any) {
  return tool({
    name: "jira_create_issue",
    description: "Create a Jira issue.",
    parameters: createJiraIssueParametersSchema,

    async execute(params, config, context) {
      context.signal?.throwIfAborted();

      const handlers = createToolCallHandlers(config);

      return handlers.createJiraIssue.handle(
        {
          projectKey: params.projectKey,
          title: params.title,
          description: params.description,
        },
        {
          signal: context.signal,
        }
      );
    },
  });
}
```

```ts id="pa9p49"
// src/index.ts

import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { jiraConfigSchema } from "./Schemas/jira-config.schema";
import { createJiraIssueTool } from "./Tools/jira-create-issue.tool";

export default defineToolPlugin({
  id: "jira-plugin",
  name: "Jira Plugin",
  description: "Adds Jira tools.",

  configSchema: jiraConfigSchema,

  tools: (tool) => [
    createJiraIssueTool(tool),
  ],
});
```

В небольшом plugin можно собирать зависимости прямо внутри `execute`. Но если tools несколько или зависимости общие, лучше использовать `Composition/create-tool-call-handlers.ts`.

Такой подход дает несколько преимуществ:

* OpenClaw-specific код остается в `Tools/` и `index.ts`.
* Поведение тула живет в `Application/ToolCallHandlers/`.
* DTO явно фиксируют contract между tool adapter и handler.
* Инфраструктурные зависимости объявлены интерфейсами в `Application/Dependencies/`.
* Реальные HTTP/SDK/file/database реализации изолированы в `Infrastructure/`.
* Handler можно тестировать без OpenClaw runtime.
* Infrastructure adapter можно заменить на mock/fake adapter.
* Код легче расширять новыми tools без копипасты HTTP/SDK-логики.

---

## Pattern 3: Считайте `openclaw.plugin.json` публичным контрактом

`openclaw.plugin.json` — это не вспомогательный файл, а контракт между плагином и OpenClaw.

В manifest должны быть синхронизированы:

* `id` плагина;
* `name` и `description`;
* `configSchema`;
* `activation`;
* `contracts.tools`;
* другие capability contracts, если плагин регистрирует не только tools.

Если tool есть в коде, но его нет в `contracts.tools`, OpenClaw может не обнаружить ownership корректно. Если tool указан в manifest, но отсутствует в runtime-коде, получится рассинхронизация между discovery и фактической регистрацией.

**Код "До":**

```json
{
  "id": "todo-plugin",
  "name": "Todo Plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  "contracts": {
    "tools": ["old_todo_tool"]
  }
}
```

```ts
tool({
  name: "todo_create",
  description: "Create a todo item.",
  // ...
});
```

**Код "После":**

```json
{
  "id": "todo-plugin",
  "name": "Todo Plugin",
  "description": "Adds todo-related tools.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  "activation": {
    "onStartup": true
  },
  "contracts": {
    "tools": ["todo_create"]
  }
}
```

После изменения tool names, config schema или plugin id нужно пересобирать и валидировать manifest.

---

## Pattern 4: Имена tools проектируйте как стабильный API

Имя tool в OpenClaw — это не просто имя функции. Это часть публичного контракта плагина.

Поэтому имя tool должно быть:

* уникальным;
* стабильным;
* понятным для модели;
* достаточно конкретным;
* без слишком общих названий вроде `search`, `create`, `delete`, `run`.

Хороший формат:

```txt
<system>_<action>_<object>
```

Примеры:

```txt
github_create_issue
github_search_pull_requests
jira_transition_issue
linear_get_ticket
notion_append_page_section
todo_create_item
```

**Код "До":**

```ts
tool({
  name: "search",
  description: "Search items.",
  // ...
});
```

**Код "После":**

```ts
tool({
  name: "jira_search_issues",
  description: "Search Jira issues by JQL.",
  // ...
});
```

Если нужно переименовать tool, лучше оставить старый tool как deprecated-обертку на время миграции, а не резко удалять его из контракта.

---

## Pattern 5: Все входные параметры и config описывайте схемами

Не используйте `any` для параметров tool и plugin config.

OpenClaw-плагин должен явно описывать:

* какие параметры принимает tool;
* какие поля есть в config;
* какие поля обязательные;
* какие значения допустимы;
* какие параметры чувствительные;
* что именно означает каждое поле.

Это помогает runtime-валидации, модели, тестам и будущей поддержке плагина.

**Код "До":**

```ts
async execute(params: any, config: any) {
  return createIssue({
    baseUrl: config.baseUrl,
    token: config.token,
    projectKey: params.projectKey,
    title: params.title,
  });
}
```

**Код "После":**

```ts
import { Type } from "typebox";

const configSchema = Type.Object({
  baseUrl: Type.String({
    description: "Jira base URL.",
  }),
  token: Type.String({
    description: "Jira API token.",
  }),
});

const createIssueParameters = Type.Object({
  projectKey: Type.String({
    description: "Jira project key, for example BACKEND.",
  }),
  title: Type.String({
    description: "Issue title.",
  }),
  description: Type.Optional(
    Type.String({
      description: "Issue description.",
    })
  ),
});

tool({
  name: "jira_create_issue",
  description: "Create a Jira issue.",
  parameters: createIssueParameters,

  async execute(params, config) {
    return createIssue({
      baseUrl: config.baseUrl,
      token: config.token,
      projectKey: params.projectKey,
      title: params.title,
      description: params.description,
    });
  },
});
```

---

## Pattern 6: Уважайте cancellation при выполнении tool

Если пользователь остановил agent run, истек timeout или OpenClaw отменил выполнение, tool должен быстро завершиться.

Не запускайте внешние HTTP-запросы, долгие циклы, чтение файлов или обращения к SDK без поддержки cancellation.

В tool execution нужно использовать `context.signal`.

**Код "До":**

```ts
tool({
  name: "external_search",
  description: "Search external API.",
  parameters: Type.Object({
    query: Type.String(),
  }),

  async execute({ query }, config) {
    const response = await fetch(
      `${config.baseUrl}/search?q=${encodeURIComponent(query)}`
    );

    return response.json();
  },
});
```

**Код "После":**

```ts
tool({
  name: "external_search",
  description: "Search external API.",
  parameters: Type.Object({
    query: Type.String(),
  }),

  async execute({ query }, config, context) {
    context.signal?.throwIfAborted();

    const response = await fetch(
      `${config.baseUrl}/search?q=${encodeURIComponent(query)}`,
      {
        signal: context.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`External search failed with status ${response.status}`);
    }

    return response.json();
  },
});
```

Если внутри tool есть цикл, проверяйте cancellation внутри цикла:

```ts
for (const item of items) {
  context.signal?.throwIfAborted();

  await processItem(item, {
    signal: context.signal,
  });
}
```

---

## Pattern 7: Плагин должен поставляться как собранный ESM-пакет

OpenClaw-плагин не должен зависеть от того, что у пользователя локально “как-нибудь” скомпилируется TypeScript.

Пакет должен поставляться с собранным runtime-кодом.

Обычно в package должны быть:

* `dist/`;
* `openclaw.plugin.json`;
* `package.json`;
* README;
* корректный `openclaw` block в `package.json`;
* ESM-настройка через `"type": "module"`;
* runtime entrypoint на собранный JavaScript-файл.

**Пример `package.json`:**

```json
{
  "name": "@acme/openclaw-jira-plugin",
  "version": "0.1.0",
  "type": "module",
  "files": [
    "dist",
    "openclaw.plugin.json",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "plugin:build": "npm run build && openclaw plugins build --entry ./dist/index.js",
    "plugin:validate": "openclaw plugins validate --entry ./dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "typebox": "^1.1.38"
  },
  "peerDependencies": {
    "openclaw": ">=2026.5.17"
  },
  "openclaw": {
    "extensions": [
      "./src/index.ts"
    ],
    "runtimeExtensions": [
      "./dist/index.js"
    ]
  }
}
```

Нельзя публиковать пакет, который работает только из `src/index.ts`, если runtime entrypoint ожидает `dist/index.js`.

---

## Pattern 8: В CI проверяйте build, manifest и runtime discovery

Для OpenClaw-плагина недостаточно проверить только `tsc`.

CI должен проверять:

* TypeScript build;
* генерацию manifest;
* валидность manifest;
* наличие runtime entrypoint;
* что tools попали в `contracts.tools`;
* что package реально устанавливается;
* что plugin можно проинспектировать после установки.

**Минимальный CI-пайплайн:**

```bash
npm ci
npm run build
openclaw plugins build --entry ./dist/index.js --check
openclaw plugins validate --entry ./dist/index.js
npm test
```

**Smoke test перед публикацией:**

```bash
npm pack
openclaw plugins install npm-pack:./acme-openclaw-jira-plugin-0.1.0.tgz
openclaw plugins inspect jira-plugin --runtime --json
```

Такой smoke test ловит ошибки, которые не видны на уровне TypeScript:

* забыли добавить `dist` в `files`;
* забыли обновить `openclaw.plugin.json`;
* `contracts.tools` не совпадает с runtime tools;
* package entrypoint указывает не туда;
* plugin валиден в исходниках, но невалиден после упаковки.
