# W29 — API

Nest + MySQL. Roda na VPS. O front (Next) fica na Vercel e fala com isto aqui.

```
navegador  →  Next na Vercel  →  esta API na VPS  →  MySQL
              (servidor)          127.0.0.1:3333      127.0.0.1:3306
```

O navegador **não** fala com a API. Quem fala é o servidor do Next: ele
guarda o token num cookie de primeira parte, no domínio da Vercel, e o
manda como `Authorization: Bearer` a cada chamada. É o que evita depender
de cookie de terceiro, que Safari e o Chrome anônimo bloqueiam.

---

## Rodar na sua máquina

```bash
cp .env.example .env          # preencha DB_* e gere o JWT_SEGREDO
npm install
npm run migracao:rodar        # cria as tabelas e as 7 categorias de gasto
npm run dev                   # http://127.0.0.1:3333/api
```

Gerar o segredo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Criar o banco, se ainda não existir:

```sql
CREATE DATABASE w29 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'w29'@'localhost' IDENTIFIED BY 'a-senha';
GRANT ALL PRIVILEGES ON w29.* TO 'w29'@'localhost';
```

**O primeiro usuário que se cadastrar vira admin.** É assim que o sistema é
instalado — não há senha embutida em lugar nenhum. Cadastre-se você antes de
dar o endereço para qualquer outra pessoa.

---

## O que mudou ao sair do Postgres

O backend antigo era o próprio banco: RLS, funções `security definer` e um
trigger. Nada disso existe no MySQL. Onde cada regra foi parar:

| Antes (Postgres) | Agora (Nest) |
|---|---|
| `fn_gerar_rateio` (trigger) | `RateioService.recalcular`, na transação do lançamento |
| 13 RPCs `security definer` | métodos de `LancamentosService` e `CadastrosService` |
| 17 policies de RLS | `SessaoGuard` global + `@SoAdmin()` + escopo por `criadoPor` |
| `auth.users` + trigger de perfil | tabela `usuarios`, com hash bcrypt |
| `CHECK`, `GENERATED ALWAYS AS` | sobreviveram: MySQL 8 tem os dois |
| views `vw_*` com `security_invoker` | views comuns, protegidas só pelo guard |

**A consequência que mais importa:** no Postgres, uma rota esquecida ainda
esbarrava na RLS antes de vazar dado. Aqui não há essa segunda muralha. Um
endpoint sem `@SoAdmin()` que devolva preço de venda, valor de contrato ou
comissão é um vazamento — não um bug de tela.

Por isso `@SoAdmin()` está na **classe** `CadastrosController`, e não em cada
método: assim o método novo já nasce protegido.

### Uma diferença de comportamento, de propósito

No Postgres, um funcionário com `valor_producao` próprio recebia
`valor_mao_obra_unit` no valor dele — e o trigger então **não gerava rateio
nenhum** para ele (`fn_gerar_rateio`, migration 0003, linhas 99–108). O
efeito era que exatamente quem negociou um valor melhor aparecia com
comissão zero em `vw_saldo_funcionarios`.

Aqui o rateio é gerado normalmente. Se aquele `return` era intencional —
alguma combinação que eu não conheço, tipo esse pessoal ser pago por fora —
a volta é curta: um `if` em `RateioService.beneficiarios`. Mas isso precisa
ser uma decisão, não uma herança.

---

## Rotas

Tudo sob `/api`. Sessão obrigatória, exceto onde está escrito.

| | |
|---|---|
| `POST /api/auth/entrar` | público |
| `POST /api/auth/cadastrar` | público — o primeiro vira admin |
| `POST /api/auth/sair` | público |
| `GET /api/auth/eu` | quem sou eu |
| `GET /api/saude` | público — 503 se o MySQL não responder |
| `GET /api/lancamentos/opcoes` | obras, serviços, funcionários, equipes, categorias |
| `GET /api/lancamentos/meus?dias=7` | o que eu lancei |
| `GET /api/lancamentos/diarias-no-dia` | aviso de diária duplicada |
| `POST /api/lancamentos/producao\|diaria\|gasto` | lançar |
| `DELETE /api/lancamentos/:tipo/:id` | apagar (24h para o operador) |
| `GET /api/painel` | **admin** — contadores |
| `GET POST PUT /api/obras` | **admin** |
| `GET POST PUT /api/servicos` | **admin** |
| `GET POST PUT /api/funcionarios` | **admin** |
| `GET POST PUT /api/equipes` | **admin** |
| `GET POST /api/usuarios`, `PATCH /api/usuarios/:id/ativo` | **admin** |

---

## Subir na VPS

A API escuta em `127.0.0.1` de propósito: quem atende a internet é o Nginx,
com o certificado. Sem isso, a porta 3333 fica exposta em HTTP puro e o
token de sessão viaja em texto claro.

### 1. Código e build

```bash
sudo adduser --system --group w29
sudo mkdir -p /opt/w29 && sudo chown w29:w29 /opt/w29

# como usuário w29:
cd /opt/w29
git clone <seu-repo> .
npm ci --omit=dev && npm install --no-save @nestjs/cli typescript
npm run build
cp .env.example .env && nano .env        # preencha tudo
npm run migracao:rodar
```

### 2. systemd

`/etc/systemd/system/w29-api.service`:

```ini
[Unit]
Description=W29 API
After=network.target mysql.service

[Service]
Type=simple
User=w29
WorkingDirectory=/opt/w29
EnvironmentFile=/opt/w29/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5

# O processo não precisa escrever em lugar nenhum além do que já é dele.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now w29-api
sudo journalctl -u w29-api -f
```

### 3. Nginx + TLS

```nginx
server {
    server_name api.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d api.seudominio.com
```

### 4. Ligar os dois lados

No `.env` da VPS:

```
ORIGENS_PERMITIDAS=https://w29.vercel.app,https://app.seudominio.com
```

Na Vercel, em Settings → Environment Variables:

```
API_URL=https://api.seudominio.com
```

A origem precisa bater exatamente — com `https://`, sem barra no fim. Quando
não bate, o navegador mostra só "CORS error" e não diz qual origem foi
recusada; quem diz é o log da API (`journalctl -u w29-api`).

### 5. Backup

Nada disto tem valor se o MySQL da VPS morrer sem cópia. O Supabase fazia
backup por você; agora é sua responsabilidade.

```bash
# /etc/cron.daily/w29-backup
mysqldump --single-transaction --databases w29 | gzip > /var/backups/w29-$(date +\%F).sql.gz
find /var/backups -name 'w29-*.sql.gz' -mtime +14 -delete
```

E mande a cópia para **fora da VPS** — um backup que mora no mesmo disco que
o banco não é backup, é uma segunda cópia do mesmo risco.
