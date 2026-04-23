# Sistema de Plantao para Corretores

Aplicacao web para gestao de plantao e distribuicao de leads em imobiliaria, com atualizacao em tempo real e operacao em tres interfaces: **Admin**, **TV** e **Mobile (QR Code)**.

Projeto desenvolvido para organizar a rotina diaria de corretores, reduzir atrito na distribuicao e dar visibilidade do fluxo em tempo real.

## Demo do projeto

- **Admin:** `http://localhost:3000/`
- **TV:** `http://localhost:3000/tv.html`
- **Mobile:** `http://localhost:3000/mobile`

> Se quiser publicar este repositorio como portfolio, vale adicionar aqui links de deploy e screenshots.

## Principais funcionalidades

- Controle de fila com regras de horario (janela de sorteio e janela final).
- Distribuicao de leads para o proximo corretor da fila.
- Gestao de presenca via QR Code no celular.
- Fluxos de saida e retorno (atendimento, almoco, nao volto).
- Painel TV com visao de fila e destaque em tempo real.
- Suporte a plantoes externos (filas paralelas por local).

## Stack utilizada

- **Backend:** Node.js + Express
- **Banco de dados:** PostgreSQL (`pg`)
- **Realtime:** WebSocket (server local) e opcional com Supabase Realtime
- **Frontend:** HTML, CSS e JavaScript (arquivos em `public/`)
- **Deploy:** Vercel (serverless em `api/*`) ou VPS/local com `server.js`

## Arquitetura resumida

```text
public/ (Admin, TV, Mobile)
        |
        v
server.js (Express + WebSocket) / api/* (Vercel)
        |
        v
db.js (regras de negocio)
        |
        v
PostgreSQL
```

## Como rodar localmente

### 1) Clonar o repositorio

```bash
git clone <URL_DO_SEU_REPO>
cd Sistema-Corretores
```

### 2) Configurar ambiente

```bash
cp .env.example .env
```

Preencha no `.env`:

```env
DATABASE_URL=sua_connection_string_postgres
```

### 3) Instalar dependencias

```bash
npm install
```

### 4) Criar estrutura do banco

```bash
node setup-db.js
```

### 5) Subir aplicacao

```bash
npm run dev
```

## Variaveis de ambiente

- `DATABASE_URL` (obrigatoria)
- `PORT` (opcional)
- `DB_READ_CACHE_TTL_MS` (opcional)
- `PG_POOL_MAX` (opcional)
- `PG_CONNECTION_TIMEOUT_MS` (opcional)
- `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` (opcional, para realtime no frontend)

## Estrutura de pastas

```text
.
├── api/                # Endpoints para modo serverless (Vercel)
├── public/             # Frontends: Admin, TV e Mobile
├── scripts/            # Scripts utilitarios
├── db.js               # Regras de negocio e acesso ao banco
├── server.js           # Servidor Node.js (Express + ws)
├── setup-db.js         # Criacao/atualizacao de schema
└── setup.sql           # Schema SQL
```

## Diferenciais tecnicos

- Regra de negocio de fila com logica de roleta por horario.
- Fallback inteligente de realtime: Supabase Realtime -> WebSocket -> polling.
- Estrutura preparada para deploy serverless e tambem ambiente tradicional.
- Operacao orientada ao dia a dia do negocio imobiliario (nao e um CRUD generico).

## Melhorias futuras

- Autenticacao para area administrativa.
- Auditoria de operacoes sensiveis (movimentacoes de fila e leads).
- Dashboard analitico de conversao por corretor e por turno.
- Exportacao de relatorios (CSV/PDF).

## Autor

Desenvolvido por felipe farias.

---

Se este projeto fizer sentido para seu contexto, fique a vontade para abrir uma issue ou contribuir.
