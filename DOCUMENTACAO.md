# Sistema de Plantão — Geum Imobiliária

Documentação técnica e funcional completa do sistema de distribuição de leads entre corretores da Imobiliária Geum.

---

## 1. Visão geral

O sistema organiza a distribuição de **leads** para **corretores** em plantão usando uma **fila FIFO com janelas de sorteio** (roleta) por horário. Ele combina:

- **Backend Node.js (Express + PostgreSQL)** com WebSocket para atualização em tempo real.
- **Três frontends** servidos da pasta `public/`:
  - **Admin** (`/`) — painel da secretária/gestor.
  - **TV** (`/tv.html`) — painel exibido em TV para os corretores.
  - **Mobile/QR** (`/mobile`) — interface que cada corretor abre ao ler um QR Code para marcar presença, saída e retorno.
- **PostgreSQL** (Supabase/Neon/Railway — qualquer Postgres 13+).
- **Deploy** em Vercel (rotas `api/*` como serverless) **ou** Node server local/VPS (`server.js` com WebSocket).

### 1.1 Conceitos-chave

| Termo | Significado |
|-------|-------------|
| **Fila principal (Souza Naves)** | Fila física dos corretores presentes no escritório principal. |
| **Plantão externo** | Fila paralela para um stand/ponto fora do escritório (ex.: "Stand 84 Jardins"). |
| **Janela de sorteio (lottery)** | Período em que quem entra é embaralhado aleatoriamente na ordem: manhã 08:30–09:01, tarde 12:00–13:06. |
| **Janela final (final_queue_window)** | Período curto após a roleta em que entradas vão para o **fim** da fila. |
| **Presença via QR Code** | Registro de que o corretor está no prédio (`broker_attendance`), independentemente da fila. |
| **Plantão dobrado** | Corretor que voltou do almoço pelo QR e está cumprindo manhã + tarde. |
| **Lead** | Cliente/oportunidade atribuída ao próximo da fila — move o corretor para o fim. |
| **Drop** | Contador rápido de perdas/descartes do dia (telefone errado, fake, etc.). |

---

## 2. Arquitetura

```
┌────────────────────────────────────────────────────────────┐
│                   Frontends (public/)                      │
│  index.html (Admin)   tv.html (TV)   mobile.html (QR)      │
└──────────────┬──────────────┬──────────────┬───────────────┘
               │   HTTP/JSON  │   WebSocket  │
┌──────────────▼──────────────▼──────────────▼───────────────┐
│   server.js (Express + ws)  ──  api/* (Vercel serverless)  │
│   ────────────────────────────────────────────────────────  │
│                         db.js                              │
│   ordenação / janelas / presença / leads / settings        │
└───────────────────────────┬────────────────────────────────┘
                            │ pg (Pool)
                ┌───────────▼────────────┐
                │   PostgreSQL           │
                │   6 tabelas            │
                └────────────────────────┘
```

### 2.1 Modos de execução

1. **Local / VPS** — `npm run dev` sobe `server.js` com HTTP + WebSocket nativo.
2. **Vercel** — cada arquivo em `api/*` vira uma função serverless. Não há WebSocket na Vercel; o realtime é feito via **Supabase Realtime** (opcional, lendo Postgres LISTEN/NOTIFY) ou fallback por polling a cada 5s.

O código em `public/*.html` detecta o modo automaticamente:
- Tenta `fetch('/api/realtime-config')` → se devolver `enabled:true` com credenciais Supabase, usa Supabase Realtime.
- Senão, abre WebSocket `ws(s)://host`.
- Senão, cai para polling `setInterval(refresh, 5000)`.

---

## 3. Banco de dados

Schema completo em `setup.sql` (e replicado em `setup-db.js`). Para aplicar:

```bash
node setup-db.js
```

### 3.1 Tabelas

#### `brokers` — corretores
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID |
| `name` | TEXT | Nome completo |
| `phone` | TEXT | Telefone opcional |
| `photo_url` | TEXT | Foto em base64 data URL (até ~600×600) |
| `active` | BOOLEAN | Soft-delete — desativar ≠ deletar |
| `created_at` | TIMESTAMPTZ | |

#### `external_shifts` — plantões externos
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID, **exceto** `00000000-...-000000000000` que é usado como sentinel para armazenar `settings`. |
| `name` | TEXT UNIQUE | Nome do plantão |
| `color` | TEXT | Hex `#rrggbb` |
| `active` | BOOLEAN | Soft-delete |
| `created_at` | TIMESTAMPTZ | |

> **Truque**: a linha com `id = '00000000-...'` é usada como store JSON de settings (campo `color`). Assim evita criar uma tabela `settings` dedicada.

#### `queue_entries` — entradas na fila
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID |
| `broker_id` | TEXT FK | → brokers |
| `position` | INT | Posição atual (1 = primeiro) |
| `status` | TEXT | `'waiting'` para entradas ativas |
| `entered_at` | TIMESTAMPTZ | Horário de chegada (usado para classificar janela) |
| `external_shift` | TEXT | NULL = Souza Naves; senão nome do plantão externo |
| `queue_rule` | TEXT | `'lottery_window'`, `'final_queue_window'`, `'regular'` ou `'external_shift'` |

#### `broker_attendance` — presença diária
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID |
| `broker_id` | TEXT FK | |
| `attendance_date` | DATE | UNIQUE (broker_id, attendance_date) |
| `first_seen_at` | TIMESTAMPTZ | Primeira leitura QR do dia |
| `last_seen_at` | TIMESTAMPTZ | Última interação |
| `status` | TEXT | `waiting`, `present_only`, `service`, `lunch`, `gone`, `absent` (virtual) |
| `presence_mode` | TEXT | `lottery_window`, `final_queue_window`, `presence_only`, `finished` |
| `last_reason` | TEXT | Último motivo de saída/retorno |
| `checkout_at` / `return_at` | TIMESTAMPTZ | Tempos de saída para atendimento |
| `lunch_started_at` / `lunch_returned_at` | TIMESTAMPTZ | Almoço |
| `assigned_shift` | TEXT | NULL = Souza Naves; senão nome do externo |
| `shift_doubled` | BOOLEAN | Corretor cumpriu manhã + tarde |

#### `leads` — leads distribuídos
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID |
| `broker_id` | TEXT FK | Quem recebeu |
| `queue_entry_id` | TEXT | Entrada que foi consumida |
| `client_name`, `phone`, `source`, `notes` | TEXT | Dados do cliente (opcionais) |
| `sent_at` | TIMESTAMPTZ | |
| `status` | TEXT | `novo` (padrão) ou customizado |

#### `drops` — contador simples de descartes do dia
Cada linha é um drop. Contagem = `COUNT(*) WHERE created_at BETWEEN hoje E amanhã`.

---

## 4. Regras de negócio (db.js)

### 4.1 Janelas de horário

Configuradas em minutos desde a meia-noite:

```js
const MAIN_QUEUE_WINDOWS = [
  { name: 'morning',   lottery_start: 510 /*08:30*/, lottery_end: 541 /*09:01*/, final_end: 546 /*09:06*/, trigger_at: 541 },
  { name: 'afternoon', lottery_start: 720 /*12:00*/, lottery_end: 786 /*13:06*/, final_end: 786, trigger_at: 786 },
];
const AFTERNOON_QUEUE_RESET_MINUTE = 12 * 60; // 12:00 — reset automático da fila
```

Além disso, `classifyAttendanceWindow(now)` define o "modo de presença":

- **08:30–09:59** → `lottery_window` (manhã)
- **12:00–13:05** → `lottery_window` (tarde)
- **Demais horas** → `presence_only` (QR só marca presença, não entra na fila)

### 4.2 Algoritmo de ordenação (`reorderShift`)

Chamado toda vez que a fila principal muda. Ordena por:

1. **Candidatos à roleta** (entraram na janela 08:30–09:01 ou 12:00–13:06) vêm primeiro.
2. **Retardatários** (entraram na janela final) vão para o fim.
3. **Regulares** (fora de janela) vêm ordenados por `entered_at` ASC.
4. Se `now >= trigger_at`, o sistema **embaralha uma única vez** os candidatos daquela janela e persiste a ordem em `settings.morning_lottery_orders[YYYY-MM-DD:name]` — isso garante que a roleta é estável (não re-sorteia a cada refresh).

Para plantões externos, a ordem é apenas FIFO (`entered_at ASC`).

### 4.3 Reset automático da fila da tarde

`ensureAfternoonQueueReset()` roda em toda leitura de `getQueue()` / `getAttendanceToday()` / `registerBrokerPresence()`:

- Se `now ≥ 12:00` e ainda não houve reset hoje:
  - Converte toda presença `waiting` da fila **principal** em `present_only`.
  - **Deleta** todas as entradas `waiting` da fila principal (externas permanecem).
  - Grava `settings.afternoon_queue_resets[YYYY-MM-DD] = now`.
- Efeito: corretores que estavam na fila da manhã precisam ler o QR novamente para entrar na fila da tarde.

### 4.4 Fluxo de presença (`registerBrokerPresence`)

O corretor abre `/mobile`, seleciona seu nome + plantão e clica "Registrar presença":

1. Cria linha em `broker_attendance` se ainda não existe.
2. Se status atual = `gone` → rejeita ("foi marcado como não volto").
3. Se já está em outra fila → rejeita ("já alocado em X").
4. Decide se entra na fila:
   - **Plantão externo selecionado** → entra no externo (sempre).
   - **Souza Naves** + horário 08:30–09:06 → entra na fila da manhã.
   - **Souza Naves** + horário 12:00–13:06 → entra na fila da tarde.
   - Outros horários → apenas `present_only` (não entra na fila).
5. Se está voltando do almoço (`status === 'lunch'` no momento do QR) → entra na fila + `shift_doubled = true`.
6. Atualiza `broker_attendance` com `last_seen_at`, `status`, `presence_mode`, `assigned_shift`.

### 4.5 Checkout (saída) — `checkoutBrokerAttendance`

Motivos aceitos:

| `reason` | Efeito |
|----------|--------|
| `atendimento` | `status = 'service'`, remove da fila, permite retorno. |
| `almoco_retorno` | `status = 'lunch'`, `lunch_started_at = now`, remove da fila. Volta via QR (dobra plantão). |
| `nao_volto` | `status = 'gone'`, encerra o dia. Não pode mais entrar na fila hoje. |

### 4.6 Retorno — `returnBrokerAttendance`

- `reason = 'atendimento'` → reentra na fila no mesmo plantão (com `presence_mode = lottery_window`).
- `reason = 'almoco_retorno'` → **bloqueado**: obriga a ler QR Code novamente (para registrar dobrado corretamente).

### 4.7 Atribuição de lead (`assignLead`)

Dois modos:

1. **Próximo da fila** — `POST /api/leads` sem body → pega posição 1 da fila principal.
2. **Corretor específico** — `POST /api/leads/specific/:entry_id` → pula a ordem e atribui direto a uma entrada.

Em ambos:
1. Insere linha em `leads` referenciando `queue_entry_id`.
2. Chama `moveToEnd(entry_id)` → atualiza `entered_at = NOW()` para mover para o fim.
3. Reordena a fila.

### 4.8 Remoção individual — `removeFromQueue`

- Remove a entrada.
- Se era da fila principal, converte a presença para `present_only` (não remove da tela de "presentes").
- Reordena o shift afetado.

### 4.9 Settings (chave/valor)

`getSettings()` / `setSetting(key, value)` / `setSettings({...})` armazenam um JSON na linha sentinel de `external_shifts`. Chaves usadas:

- `tv_theme` — `'dark'` ou `'light'`.
- `plantonistas` — array de `broker_id` dos 1-2 plantonistas do dia (manuais ou vazio = automático).
- `morning_lottery_orders` — `{ 'YYYY-MM-DD:morning': [id1, id2...], 'YYYY-MM-DD:afternoon': [...] }`.
- `afternoon_queue_resets` — `{ 'YYYY-MM-DD': 'iso-timestamp' }`.

### 4.10 Cache de leitura

`db.js` tem cache em memória com TTL configurável (`DB_READ_CACHE_TTL_MS`, padrão 15s em dev, 0 na Vercel). Toda mutação chama `invalidateReadCache()`.

---

## 5. Endpoints HTTP

Todos os endpoints existem **duas vezes**:
- Em `server.js` para o modo Express local/VPS.
- Em `api/*.js` para o modo Vercel serverless.

Mesma semântica, mesmo contrato. Para Vercel, cada rota com `[id]` ou `[name]` usa convenção de arquivo.

### 5.1 Settings / Config

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/settings` | Retorna settings (inclui `tv_theme`, `plantonistas`). |
| PUT | `/api/settings` | Atualiza settings (merge). |
| GET/PUT | `/api/plantonistas` | Atalho específico para plantonistas. |
| GET | `/api/realtime-config` | Retorna `{enabled, url, key}` do Supabase Realtime. |
| GET | `/api/health` | Checagem rápida; `?deep=1` testa o banco. |

### 5.2 Plantões externos

| Método | Rota | Body |
|--------|------|------|
| GET | `/api/external-shifts` | — |
| POST | `/api/external-shifts` | `{ name, color? }` |
| PUT | `/api/external-shifts/:id` | `{ name?, color? }` |
| DELETE | `/api/external-shifts/:id` | soft-delete (`active=false`) |

### 5.3 Corretores

| Método | Rota | Body |
|--------|------|------|
| GET | `/api/brokers` | — |
| POST | `/api/brokers` | `{ name, phone?, photo_url? }` |
| PUT | `/api/brokers/:id` | qualquer subset de `{name, phone, active, photo_url}` |
| DELETE | `/api/brokers/:id` | soft-delete + remove da fila |

### 5.4 Presença / Attendance

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/attendance` | Presença de **hoje** de todos os corretores ativos. |
| GET | `/api/attendance/insights?month=YYYY-MM` | Agregados mensais (calendário, ranking). |
| GET | `/api/attendance/:brokerId` | Presença de hoje de um corretor específico. |
| DELETE | `/api/attendance` | Apaga presença + fila de hoje. |
| POST | `/api/attendance/check-in` | `{ broker_id, entered_at?, external_shift? }` |
| POST | `/api/attendance/checkout` | `{ broker_id, reason: 'atendimento'\|'almoco_retorno'\|'nao_volto' }` |
| POST | `/api/attendance/return` | `{ broker_id, reason: 'atendimento' }` |

### 5.5 Fila

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/queue` | Fila principal (Souza Naves). |
| GET | `/api/queue/external` | Filas externas agrupadas por plantão. |
| POST | `/api/queue` | `{ broker_id, entered_at?, external_shift?, admin_override? }` |
| POST | `/api/queue/reorder` | `{ ids: [uuid, uuid, ...] }` — reordena drag&drop. |
| DELETE | `/api/queue` | Limpa fila principal (presenças viram `present_only`). |
| DELETE | `/api/queue/:id` | Remove uma entrada. |
| DELETE | `/api/queue/external/:name` | Encerra fila de um plantão externo. |
| POST | `/api/queue/:id/move-to-end` | Move uma entrada para o fim. |

### 5.6 Leads

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/leads` | Últimos 100 leads. |
| POST | `/api/leads` | Atribui ao próximo da fila. Body opcional: `{client_name, phone, source, notes}`. |
| POST | `/api/leads/specific/:entry_id` | Atribui a um corretor específico (pula a fila). |
| PUT | `/api/leads/:id/status` | `{ status }` |
| DELETE | `/api/leads` | Limpa os leads enviados hoje. Use `?scope=all` para apagar todo o histórico. |

### 5.7 Drops

| Método | Rota | |
|--------|------|---|
| GET | `/api/drops` | `{ drops_hoje: N }` |
| POST | `/api/drops` | Incrementa. |
| DELETE | `/api/drops/last` | Remove o último do dia. |

### 5.8 Stats / TV

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/stats` | Agregados: hoje por corretor, 7 dias, últimos 5 leads. |
| GET | `/api/tv-data` | Payload otimizado para a TV (`queue + externalQueues + stats + drops_hoje + settings + brokers`). Tem cache próprio de 15s. |

---

## 6. WebSocket (modo server.js)

Na conexão, o servidor envia um snapshot completo:

```json
{
  "type": "queue_update",
  "queue": [...],
  "external_queues": [...],
  "external_shifts": [...],
  "stats": {...},
  "settings": {...},
  "brokers": [...],
  "drops_hoje": 0,
  "attendance": [...]
}
```

A cada mutação (POST/PUT/DELETE), `broadcastQueueUpdate()` envia esse snapshot para todos os clientes conectados. Eventos específicos adicionam campos:

- `lead_assigned` → inclui `lead` e `broker`.
- `drops_update` → apenas `drops_hoje`.
- `settings_update` → apenas `settings`.

---

## 7. Frontend — Admin (`public/index.html`)

### 7.1 Painéis (tabs)

| Tab | Pane ID | Função |
|-----|---------|--------|
| Painel Principal | `pane-lead` | Operação do dia: próximo da fila, lista, plantões externos, presença, plantonistas, drops. |
| Acompanhamento | `pane-acompanhamento` | Calendário mensal e ranking de presenças. |
| QG de Corretores | `pane-corretores` | CRUD de corretores (com upload/crop de foto). |
| Configurar Plantões | `pane-plantoes` | CRUD de plantões externos (nome + cor). |
| Estatísticas | `pane-stats` | KPIs de leads (hoje, 7 dias, total). |

### 7.2 Fluxo do Painel Principal

- **Hero "Próximo a receber lead"** → mostra `queue[0].broker_name` e botão "Enviar Lead Agora" → `POST /api/leads`.
- **Adicionar à fila** → selecionar corretor + (opcional) horário de chegada forçado → `POST /api/queue { admin_override: true }`. O `admin_override` ignora a checagem de janela.
- **Fila** → drag-and-drop reordena (`POST /api/queue/reorder`). Menu de 3 pontos tem "Enviar Lead" direto.
- **Plantonistas do Dia** → selects com 1-2 corretores. `PUT /api/plantonistas` grava em settings.
- **Plantão Externo Rápido** → selecionar corretor + shift → `POST /api/queue { external_shift, admin_override: true }`.
- **Presença no Prédio** → lista `GET /api/attendance`, status + horário do primeiro registro QR. Lixeira → `DELETE /api/attendance` (apaga presença + fila do dia).
- **Drops** → `POST /api/drops` / `DELETE /api/drops/last`.

### 7.3 Acompanhamento mensal

- Input `<input type="month">` seleciona o mês.
- `GET /api/attendance/insights?month=YYYY-MM` retorna:
  - `summary`: active_brokers, days_with_attendance, average_daily_presence, broker_most_presence, broker_least_presence, total_shift_doubled_records.
  - `daily[]`: para cada dia do mês — present_count, doubled_count, brokers[] com status.
  - `ranking[]`: broker_name + presence_days + waiting/present_only/service/lunch/gone/shift_doubled_days.
- Render:
  - 4 KPI cards.
  - Calendário 7×N com até 4 nomes/dia.
  - Ranking top 8 presença.
  - "Atenção" com os 5 menos presentes.

### 7.4 QG de Corretores

- Formulário com upload de foto (Cropper.js, 1:1, 600×600).
- Foto é salva como `data:image/jpeg;base64,...` direto na coluna `photo_url`. Não há storage externo.
- Botão de lixo = soft-delete (`active=false`). Também remove entradas `waiting` e reordena shifts.

### 7.5 Configurar Plantões

CRUD simples (nome + cor hex). A cor é usada para colorir a fila externa correspondente no admin e na TV.

### 7.6 Realtime no admin

1. Tenta Supabase Realtime (se `/api/realtime-config` estiver habilitado).
2. Senão, WebSocket para `ws://host` (só funciona com `server.js`).
3. Fallback: `setInterval(refreshQueueState, 5000)` chamando múltiplos GETs em paralelo.

---

## 8. Frontend — TV (`public/tv.html`)

- Layout 3 linhas: header 72px, main (grid fila + sidebar 410px), footer 48px.
- **Grid de corretores** com card especial "first" (liquid-glass dourado) para o próximo da fila e grid responsivo para o resto.
- **Animações** `card-enter`, `crown-bounce`, `ambient`.
- **Popups** animados para novo lead, entrada na fila e drop.
- **Sons** via WebAudio (overlay "clique para ativar áudio" na primeira interação — contorna autoplay-block).
- **Tema**: claro/escuro controlado por `settings.tv_theme`. Troca o logo automaticamente.
- Consome `GET /api/tv-data` (payload otimizado com cache de 15s).
- Realtime idêntico ao admin (Supabase → WS → polling).

---

## 9. Frontend — Mobile/QR (`public/mobile.html`)

Tela única que o corretor abre ao escanear o QR Code afixado no plantão. Persiste sessão em `localStorage` (chave `mobile_broker_session_v2`).

### 9.1 Estados de tela

| Estado | Quando | O que mostra |
|--------|--------|--------------|
| **Logged-out** | Sem sessão ou `status === 'lunch'` ou `status === 'gone'` | Selects de corretor + plantão + botão "Registrar presença". |
| **Logged-in** | Status `waiting` / `present_only` | Nome + plantão atual + select de motivo de saída. |
| **Return** | Status `service` | Motivo do retorno (atendimento). |

### 9.2 Fluxo típico do dia

1. **Chegada (~08:30)** — abre mobile, seleciona nome + plantão, clica "Registrar presença". Se Souza Naves → entra na roleta. Se externo → entra no FIFO.
2. **Saiu para atendimento** — seleciona "Atendimento", confirma saída. Status = `service`. Sai da fila.
3. **Voltou do atendimento** — tela de retorno aparece. Seleciona "Atendimento" em motivo de retorno → volta para a fila no mesmo plantão.
4. **Almoço** — seleciona "Almoço e retorno". Status = `lunch`. Sessão é apagada.
5. **Volta do almoço (~12h)** — lê QR **novamente**. Presença é recriada com `shift_doubled = true` e entra na fila da tarde.
6. **Encerrou o dia** — seleciona "Não volto". Status = `gone`. Não pode mais entrar na fila hoje.

### 9.3 Polling

A tela roda `setInterval(refreshAttendance, 15000)` para refletir mudanças feitas no admin (ex.: admin removeu ele manualmente ou limpou a fila).

---

## 10. Catálogo de funções do `db.js`

### Helpers de data
- `today()` / `tomorrow()` / `weekAgo()` — ISO strings para queries de data.
- `localDateKey(date)` — `YYYY-MM-DD` no fuso local.
- `monthKey(date)` — `YYYY-MM`.
- `minutesOfDay(date)` — `h*60 + m`.
- `secondsOfDay(date)` — `h*3600 + m*60 + s`.
- `parseDbDate(value)` — normaliza timestamps vindos do Postgres.
- `parseMonthInput(value)` — valida `YYYY-MM`, default = mês atual.

### Helpers de janela
- `classifyMainQueueWindow(entryDate, now, override?)` → `'lottery_window' | 'final_queue_window' | 'regular'`.
- `classifyAttendanceWindow(now)` → retorna o modo de presença.
- `shouldAutoJoinMainQueue(now)` → `true` entre 08:30–09:06 e 12:00–13:06.
- `attendanceStatusLabel(status, shiftDoubled)` → texto PT-BR.
- `isSameLocalDay(a, b)` / `isLotteryCandidateInWindow(...)` / `isFinalQueueWindow(...)`.
- `isAllowedMainQueueEntryMinute(mins)` — true se o minuto está dentro de qualquer janela.

### Cache
- `cachedRead(key, loader)` — leitura com TTL.
- `invalidateReadCache()` — limpa o cache inteiro.

### Mappers
- `mapQueueRow(row)` — row do Postgres → shape esperado pelos frontends.
- `mapAttendanceRow(row)` — idem para attendance.
- `shuffleArray(arr)` — Fisher-Yates.

### Ordenação
- `reorderShift(external_shift)` — recomputa `position` de todas as entradas `waiting` de um shift.

### External shifts
- `getExternalShifts()` — ativos, ordenados por nome.
- `createExternalShift({name, color})` — trata conflict 23505 como "já existe".
- `updateExternalShift(id, {name?, color?})`.
- `deleteExternalShift(id)` — soft-delete.

### Brokers
- `getBrokers()` — ativos, ordenados por nome.
- `createBroker({name, phone?, photo_url?})`.
- `updateBroker(id, {name?, phone?, active?, photo_url?})`.
- `deleteBroker(id)` — remove da fila, reordena shifts afetados, soft-delete.
- `getWaitingEntryByBroker(broker_id)` — entrada ativa atual de um corretor.

### Attendance
- `ensureAttendanceSchema()` — garante a coluna `assigned_shift` (idempotente).
- `getAttendanceByBrokerForDate(broker_id, date?)`.
- `ensureAttendanceRow(broker_id, now?)` — get-or-create.
- `updateAttendanceState(broker_id, patch, date?)` — patch parcial.
- `getAttendanceToday()` — LEFT JOIN com brokers ativos (corretores sem presença aparecem com `status='absent'`).
- `getAttendanceInsights(month)` — agregados mensais.
- `registerBrokerPresence(broker_id, options)` — ver §4.4.
- `checkoutBrokerAttendance(broker_id, reason)` — ver §4.5.
- `returnBrokerAttendance(broker_id, reason)` — ver §4.6.
- `clearAttendance()` — apaga presença + fila do dia.

### Queue
- `getQueue()` — fila principal.
- `getExternalQueues()` — agrupa por plantão + adiciona cor.
- `addToQueue(broker_id, entered_at, external_shift, options)`.
- `setQueueOrder(ids)` — aceita drag&drop do admin.
- `clearQueue()` — só principal; presenças viram `present_only`.
- `ensureAfternoonQueueReset(now)` — reset automático às 12:00 (idempotente por dia).
- `clearExternalQueue(name)` — encerra um plantão.
- `removeFromQueue(entry_id)`.
- `moveToEnd(entry_id)` — atualiza `entered_at = NOW()` e reordena.

### Leads
- `assignLead({client_name?, phone?, source?, notes?, entry_id?})`.
- `getLeads(limit=100)` — inclui contador `leads_no_dia` por corretor.
- `updateLeadStatus(lead_id, status)`.
- `clearLeads(scope='today')` — por padrão limpa apenas os leads enviados hoje; use `all` para apagar tudo.

### Drops
- `addDrop()` / `removeDrop()` / `getDropsHoje()`.

### Stats
- `getStats()` — agregados paralelos: hoje/semana/total + top 5 últimos leads.

### Settings
- `getSettings()`, `setSetting(key, value)`, `setSettings(obj)` — todos gravam na linha sentinel.

---

## 11. Scripts utilitários

### `scripts/verify-db-smoke.js`
Smoke test rápido: `DATABASE_URL=... node scripts/verify-db-smoke.js`. Executa as leituras principais e valida shapes.

### `scripts/import-brokers-from-csv.js`
Importa corretores de um CSV do Google Workspace. Filtra contas administrativas por heurística de nome/e-mail. Flags:
- `--dry-run` — só mostra o que seria importado.
- `--include-service-accounts` — desliga o filtro.

Uso: `node scripts/import-brokers-from-csv.js path/arquivo.csv`.

### `setup-db.js`
Cria/migra o schema completo. Usa `ADD COLUMN IF NOT EXISTS` para ser idempotente em bases já existentes.

---

## 12. Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
|----------|-------------|---------|-----------|
| `DATABASE_URL` | **Sim** | — | Connection string Postgres com SSL. |
| `PORT` | não | 3000 | Porta do `server.js`. |
| `DB_READ_CACHE_TTL_MS` | não | 15000 (dev) / 0 (Vercel) | TTL do cache em memória. |
| `PG_POOL_MAX` | não | 10 | Tamanho do pool. |
| `PG_CONNECTION_TIMEOUT_MS` | não | 8000 | Timeout para obter conexão. |
| `TV_DATA_CACHE_TTL_MS` | não | 15000 (dev) / 0 (Vercel) | Cache do endpoint `/api/tv-data`. |
| `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (ou `SUPABASE_ANON_KEY`) | não | — | Ativa Supabase Realtime no frontend. |

---

## 13. Deploy

### 13.1 Vercel (recomendado)

1. Conecte o repo.
2. Defina `DATABASE_URL` (e, opcionalmente, `SUPABASE_URL` + key).
3. Rode `node setup-db.js` localmente uma vez para criar o schema.
4. Deploy.

O `vercel.json` faz rewrites para servir `index.html`, `tv.html` e `mobile.html` como rotas amigáveis.

⚠️ **Atenção**: na Vercel, o WebSocket do `server.js` **não funciona**. Para realtime na Vercel, configure Supabase Realtime (publicar as 6 tabelas no schema público) ou dependa do polling de 5s.

### 13.2 Local / VPS

```bash
cp .env.example .env    # preencha DATABASE_URL
npm install
node setup-db.js
npm run dev             # ou npm start em produção
```

URLs:
- Admin: `http://localhost:3000/`
- TV: `http://localhost:3000/tv.html`
- Mobile/QR: `http://localhost:3000/mobile`

---

## 14. Fluxo do dia — ponta a ponta

```
08:20 — Admin abre o painel, ajusta plantonistas do dia.
08:30 — Corretores começam a chegar. Cada um lê o QR Code no celular,
        seleciona seu nome e clica "Registrar presença".
        → Fila da manhã recebe entradas "lottery_window".
09:01 — Trigger da manhã: sistema sorteia a ordem dos candidatos
        e persiste em settings.morning_lottery_orders.
        TV exibe a fila sorteada em tempo real.
09:01–09:06 — Retardatários entram na janela final (vão para o fim).
10:00 — Lead chega. Admin clica "Enviar Lead Agora" (ou via menu direto).
        → Posição 1 recebe o lead, move para o fim.
        → Popup e som na TV. Broadcast WebSocket/Realtime.
11:30 — Corretor sai para atendimento. No mobile: "Saída → Atendimento".
        → Status = service. Sai da fila.
12:00 — Reset automático: fila da manhã é esvaziada. Presenças
        viram "present_only".
12:00 — Corretores leem QR de novo para entrar na fila da tarde.
        Quem voltou do almoço → shift_doubled = true.
13:06 — Trigger da tarde: sorteio da roleta da tarde.
18:00 — Dia encerra. Admin limpa presença se quiser.
```

---

## 15. Boas práticas e pegadinhas

### Operação diária
- **Não apague a fila manualmente**: use o reset automático das 12:00. Apagar manualmente (`DELETE /api/queue`) já converte presenças em `present_only` como deve.
- **Drag & drop da fila ignora a roleta**: `setQueueOrder(ids)` força a ordem literal. Use só para correções pontuais, pois a próxima chamada a `reorderShift` pode reordenar.
- **Soft-delete em tudo**: brokers e external_shifts nunca são removidos do banco. Isso preserva referências em `queue_entries`, `leads` e `broker_attendance`.
- **`admin_override: true`** no `POST /api/queue` ignora a checagem de janela — é o que o admin usa ao adicionar manualmente.
- **Foto do corretor** é base64 no banco — cuidado com linhas muito grandes; a rotina do admin já resize/crop para 600×600 JPEG.

### Desenvolvimento
- Mudanças de schema → adicione `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` em `setup-db.js` e em `setup.sql`, e se precisar de migração em runtime, use o padrão de `ensureAttendanceSchema()`.
- Toda mutação deve chamar `invalidateReadCache()` — senão o cache de 15s entrega dados velhos.
- Ao adicionar um endpoint no `server.js`, crie também o handler em `api/*.js` para manter paridade Vercel.
- Os endpoints Vercel (`api/*.js`) não têm `express.json()`; por isso cada handler implementa a função `body(req)` que lê `req.body` (já parseado pela Vercel) ou chunks manuais.
- WebSocket só existe no `server.js`. Em Vercel o realtime depende de Supabase ou polling.

### Segurança
- Não há autenticação. O painel assume rede interna/confiável. Se expor publicamente, coloque atrás de um proxy com basic auth.
- `ssl: { rejectUnauthorized: false }` é usado por compatibilidade com Supabase. Em ambientes com CA próprio, ajuste.
- `RLS` está desabilitado (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`) porque o acesso é sempre via backend com connection string service-role.

### Performance
- Pool máximo 10 por padrão — aumente via `PG_POOL_MAX` se houver muitas conexões simultâneas.
- `/api/tv-data` tem cache dedicado (15s em dev) para aliviar a TV, que faz polling constante.
- Paralelize leituras: todo o backend usa `Promise.all` para leituras independentes (`getBrokers`, `getSettings`, `getQueue`, etc.).

### Realtime
- Supabase Realtime requer habilitar replication nas 6 tabelas (`brokers`, `external_shifts`, `queue_entries`, `broker_attendance`, `leads`, `drops`).
- Em modo WebSocket puro, o servidor faz broadcast completo a cada mutação — simples mas custoso para muitos clientes. OK para escritórios pequenos (≤50 telas).

---

## 16. Troubleshooting

| Sintoma | Causa provável | Correção |
|---------|----------------|----------|
| "DATABASE_URL não definida" | `.env` ausente ou não carregado | Preencher `.env` com a string do Postgres. |
| Fila não aparece na TV | WebSocket bloqueado por proxy / CDN | Configurar Supabase Realtime ou desbloquear WS. |
| Corretor aparece duas vezes na fila | Inserção concorrente | `addToQueue` checa duplicidade, mas se vier corrompido, limpe e reimporte. |
| Roleta não embaralha | `now < trigger_at` ainda | Aguardar 09:01 / 13:06; ou forçar via admin drag&drop. |
| Fotos muito grandes | `photo_url` em base64 | Rotina do admin já redimensiona; se veio de import, atualize manualmente. |
| Reset da tarde não ocorreu | `ensureAfternoonQueueReset` só roda em leituras; se ninguém acessou, só dispara no primeiro GET após 12:00 | Normal; qualquer leitura depois das 12:00 dispara. |

---

## 17. Roadmap sugerido

- Autenticação básica (ex.: JWT + bcrypt) para admin.
- Auditoria: tabela `audit_log` com quem moveu/excluiu o quê.
- Migrar fotos de base64 para storage (Vercel Blob / Supabase Storage).
- Métricas exportáveis: CSV mensal de presença e leads.
- Notificações push para o corretor quando receber um lead.
- Testes automatizados (pelo menos `scripts/verify-db-smoke.js` está lá como esqueleto).

---

*Documento gerado a partir da leitura completa do código em `/Users/user/Sistema-Corretores` (commit atual: `414a487` — "Adiciona janela de sorteio da tarde e ajusta janela da manha").*
