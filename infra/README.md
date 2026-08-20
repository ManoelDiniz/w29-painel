# infra

`provision-ubuntu.sh` — provisiona a VPS do zero. Idempotente: pode rodar de
novo quantas vezes quiser.

## O comando para o W29

Na sua máquina:

```bash
scp infra/provision-ubuntu.sh root@IP_DA_VPS:/root/   # a partir da raiz do repo
ssh root@IP_DA_VPS
```

No servidor:

```bash
chmod +x provision-ubuntu.sh

./provision-ubuntu.sh \
    --chave "$(cat ~/.ssh/id_ed25519.pub)" \
    --banco w29 \
    --api w29-painel \
    --api-git git@github.com:ManoelDiniz/w29-painel.git \
    --api-dominio api.mnvma.com \
    --ssl
```

Isso entrega, numa passada: usuário `ubuntu` com chave, SSH sem senha, UFW,
fail2ban, nginx, redis, **MySQL com o banco `w29` já criado**, o serviço
systemd `w29-painel` e o `.env` da API já preenchido — credenciais do banco
e um `JWT_SEGREDO` gerado na hora.

**Vai parar uma vez**, e é esperado: o script gera uma chave de deploy e a
imprime na tela, porque o GitHub ainda não a conhece. Cadastre em
**Settings → Deploy keys** do repositório (não precisa de write access) e
publique:

```bash
sudo -u ubuntu /usr/local/bin/publicar-w29-painel
```

Dali em diante, esse é o comando de deploy: ele faz `git pull`, `npm ci`,
build, migrations, restart — e **confere que `/api/saude` voltou a
responder** antes de dizer que deu certo.

## Os dois modos de deploy

| | `--api-git` (GitHub) | sem `--api-git` (push) |
|---|---|---|
| origem do código | clone do GitHub | repositório bare na VPS |
| como publica | `publicar-w29-painel` no servidor | `git push vps main` da sua máquina |
| precisa de | chave de deploy cadastrada | nada além do SSH |
| o que está no ar | sempre um commit que existe no GitHub | pode ser um push que só a VPS viu |

Escolha um. Ter os dois seria duas fontes da verdade sobre o que está
publicado — e um push direto para o bare sumiria do histórico do GitHub sem
ninguém notar. Por isso `--api-git` desliga o bare.

O modo push é o que funciona quando o GitHub está fora do ar, ou quando a
internet da obra não aguenta um clone mas aguenta um SSH.

Nos dois modos os passos de build/migration/restart são o **mesmo arquivo**
(`/usr/local/bin/publicar-NOME`) — o hook de push só põe o código no lugar e
chama esse comando. Ajustar o deploy é mexer num lugar só.

Sem `--api-dominio` e `--ssl` também funciona: o vhost sobe em HTTP puro
pegando qualquer host. Serve para testar, não para produção — sem TLS o
token de sessão viaja em texto claro.

## Servidor que já passou por aqui

Para só montar a camada da API (serviço, vhost, deploy) num servidor já
provisionado, sem refazer a base:

```bash
./provision-ubuntu.sh --pular-base --api w29-painel     --api-git git@github.com:ManoelDiniz/w29-painel.git     --api-dominio api.mnvma.com
```

`--pular-base` salta pacotes, usuário, SSH, Node, Python, firewall, nginx e
redis. Antes de seguir, ele confere que `git`, `nginx`, `node`, `npm`,
`openssl` e `curl` existem e que o usuário `ubuntu` está lá — errando com o
nome do que falta, em vez de deixar você descobrir no meio de um deploy.

Uma segunda API na mesma VPS é o mesmo comando com outra porta:

```bash
./provision-ubuntu.sh --pular-base --api outra-api --api-porta 3334 \
    --api-dominio outra.mnvma.com --ssl
```

Rodar sem `--pular-base` também funcionaria — a base é idempotente. Só é
lento e recarrega o SSH sem necessidade.

## Antes de rodar: o DNS

O `--ssl` usa o desafio HTTP-01 — a Let's Encrypt bate de volta na porta 80
do domínio. Se o DNS de `api.mnvma.com` ainda não apontar para o IP da VPS,
o certbot falha. O script avisa e segue; é só rodar depois:

```bash
sudo certbot --nginx -d api.mnvma.com
```

Confira antes com `dig +short api.mnvma.com` — precisa devolver o IP da VPS.

## O ciclo do dia a dia

```bash
# na sua máquina
cd backend
git push origin main

# no servidor
sudo -u ubuntu /usr/local/bin/publicar-w29-painel
```

Depois que o front subir na Vercel, acrescente o domínio dele em
`ORIGENS_PERMITIDAS` — sem isso o navegador recusa toda chamada com um
"CORS error" que não diz qual origem foi barrada (quem diz é o log da API):

```bash
sudo nano /var/www/w29-painel/current/.env
sudo systemctl restart w29-painel
```

E no projeto do front, na Vercel:

```
API_URL=https://api.mnvma.com
```

**O primeiro usuário que se cadastrar vira admin.** Cadastre-se antes de dar
o endereço para qualquer outra pessoa.

## Por que isto mora aqui

`infra/` está dentro do repositório do backend porque é o servidor do
backend que ele provisiona — e porque script de deploy que vive fora do
git é script que se perde na primeira troca de máquina.

Consequência: o `infra/` vai junto no deploy, para `/var/www/w29-painel/`.
São alguns KB de shell parados num diretório; não atrapalha nada e mantém a
receita do servidor ao lado do que ela serve.

Se um dia você usar este script noutros projetos, ele merece repositório
próprio — a base dele (SSH, UFW, fail2ban, nginx) não tem nada de W29, e
copiar entre repos é como as versões começam a divergir.

## Onde as coisas ficam

| | |
|---|---|
| credenciais do MySQL | `/root/mysql-w29.txt` (0600) |
| `.env` da API | `/var/www/w29-painel/current/.env` (0600) |
| código publicado | `/var/www/w29-painel/current` |
| comando de deploy | `/usr/local/bin/publicar-w29-painel` |
| chave de deploy | `/home/ubuntu/.ssh/deploy_w29-painel.pub` |
| repo bare (só no modo push) | `/var/repo/w29-painel.git` |
| log do deploy | `/var/log/deploy/w29-painel.log` |
| log do serviço | `journalctl -u w29-painel -f` |
| backup do banco | `/var/backups/mysql/` (diário, 14 dias) |

O backup fica no mesmo disco do banco — isso não é backup, é uma segunda
cópia do mesmo risco. Configure envio para fora da VPS.
