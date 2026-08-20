#!/usr/bin/env bash
#
# provision-ubuntu.sh — provisionamento padrão de servidor Ubuntu 22.04 / 24.04
#
# BASE (sempre roda):
#   • usuário `ubuntu` (senha `ubuntu`) com sudo sem senha
#   • SSH por CHAVE, senha desligada
#   • Node.js (NodeSource) + Python 3 (venv/pip/pipx)
#   • UFW ligado (22/80/443) + fail2ban vigiando o SSH
#   • nginx instalado SEM vhost, rodando como `ubuntu`
#   • redis-server escutando só em localhost
#
# CAMADA MYSQL (só com --mysql ou --banco NOME):
#   • mysql-server 8.0 escutando só em localhost
#   • banco NOME em utf8mb4 + usuário NOME com senha forte gerada aqui
#   • credenciais salvas em /root/mysql-NOME.txt (modo 0600)
#   • anônimos e base `test` removidos; root só pelo socket
#
# CAMADA API NODE (só com --api NOME):
#   • serviço systemd NOME.service escutando em 127.0.0.1
#   • vhost nginx fazendo proxy para a porta do serviço
#   • comando /usr/local/bin/publicar-NOME: build, migration, restart e
#     conferência de que /api/saude voltou a responder
#   • se --banco veio junto, o .env já nasce com as credenciais do MySQL
#
#   Dois modos de deploy, e só um por vez:
#     sem --api-git  → repositório bare em /var/repo/NOME.git; você dá push
#                      para a VPS e o hook publica
#     com --api-git  → a VPS clona do GitHub; o script gera uma chave de
#                      deploy, mostra a chave pública para você cadastrar, e
#                      dali em diante publicar é `publicar-NOME`
#
#   Ter os dois seria duas fontes da verdade sobre o que está no ar — um push
#   direto para o bare sumiria do histórico do GitHub sem ninguém notar.
#
# CAMADA LARAVEL (só com --app NOME):
#   • PHP 8.2 FPM (PPA ondrej) com as extensões do Laravel, pool rodando como `ubuntu`
#   • Composer, cliente MySQL (para o RDS), certbot
#   • repositório bare em /var/repo/NOME.git + hook de deploy
#   • vhost nginx apontando para /var/www/NOME/current/public
#   • cron do schedule:run com log de verdade
#
# COMO USAR
#   scp provision-ubuntu.sh root@SERVIDOR:/root/
#   ssh root@SERVIDOR
#   chmod +x provision-ubuntu.sh
#
#   # só o baseline:
#   ./provision-ubuntu.sh --chave "ssh-ed25519 AAAA... voce@maquina"
#
#   # baseline + MySQL + a API do w29 puxando do GitHub:
#   ./provision-ubuntu.sh --chave "ssh-ed25519 AAAA..." \
#        --banco w29 --api w29-painel \
#        --api-git git@github.com:ManoelDiniz/w29-painel.git \
#        --api-dominio api.exemplo.com --ssl
#
#   # o mesmo, mas com deploy por push em vez de GitHub:
#   ./provision-ubuntu.sh --chave "ssh-ed25519 AAAA..." \
#        --banco w29 --api w29-painel --api-dominio api.exemplo.com --ssl
#
#   # baseline + Laravel pronto para deploy:
#   ./provision-ubuntu.sh --chave "ssh-ed25519 AAAA..." \
#        --app meuapp --dominio app.exemplo.com --ssl
#
#   # servidor JÁ provisionado, só quero o repositório bare de outra API:
#   ./provision-ubuntu.sh --pular-base --api outra-api --api-porta 3334
#
#   Sem --chave ele procura, nesta ordem: $CHAVE_SSH →
#   /root/.ssh/authorized_keys → /home/ubuntu/.ssh/authorized_keys.
#   NÃO ACHANDO CHAVE NENHUMA, mantém o login por senha ligado e avisa:
#   desligar a senha sem chave instalada tranca você para fora do servidor.
#
#   --pular-base salta pacotes, usuário, SSH, Node, Python, firewall, nginx e
#   redis, indo direto para as camadas. É para quando o servidor já passou por
#   aqui: rodar a base de novo não quebra nada, mas gasta minutos em apt
#   upgrade e recarrega o SSH sem necessidade.
#
# Pode rodar de novo quantas vezes quiser — é idempotente. A senha do MySQL
# é gerada UMA vez e relida do arquivo nas execuções seguintes; se ela fosse
# sorteada de novo a cada run, todo re-provisionamento quebraria o .env do
# app que já estava rodando.
#
set -euo pipefail

# ---------------------------------------------------------------- parâmetros

USUARIO="${USUARIO:-ubuntu}"
SENHA="${SENHA:-rOEV3b6F489LtKEcLSMdd}"
PORTA_SSH="${PORTA_SSH:-22}"
NODE_MAJOR="${NODE_MAJOR:-22}"     # 22 = LTS. Troque para 24 se quiser o mais novo.
PHP_VER="${PHP_VER:-8.2}"
# SEM espaço depois do `:-` — o espaço faria parte do valor, a chave entraria no
# authorized_keys com um branco na frente e a checagem ancorada (`^ssh-…`) lá
# embaixo não a reconheceria: o script manteria o login por senha ligado achando
# que não há chave nenhuma.
CHAVE_SSH="${CHAVE_SSH:-ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCOrt7IGfQ3FCx+ngMAQfXhxfW/AFMMkFx0bsEdjkjhLNFikSdlD2dqaMExrC72H8TAevRSJMDiRnJGD3IBA3eoNrX7V7FtICItrhrXBwX+LgClghlPT0cjizrIqHf/42/O3cPANx6//eAMsW5UIf+JSH2RvFr/IYNM4Mu5p4q/6BIatr1gjhYt68YstI72kc9ax/y3hocKf6NmqKmx+HuKFLOwkZJKOlW4IK4+D7EUxw66469wK+pzQwIlhE4yLcv6dsVzdTJ81rlKDpOVqZvPC4043S+4Rp8V7qcZcvkEvOxmA46O6T0DNw3TUBG+N1Qoq7nM6Ulv8YxI35U2BkYl}"
MANTER_SENHA_SSH="nao"
PULAR_BASE="nao"                    # sim = servidor já provisionado, só as camadas
APP=""                             # nome do app Laravel; vazio = não instala a camada
DOMINIO=""
BRANCH="${BRANCH:-main}"
RODAR_SSL="nao"

INSTALAR_MYSQL="sim"
BANCO="w29-painel"                           # nome do banco/usuário a criar

API="W29-Project"                             # nome da API Node; vazio = não instala a camada
API_DOMINIO="mnvma.com"
API_PORTA="${API_PORTA:-3333}"
API_BRANCH="${API_BRANCH:-main}"
API_GIT=""                         # URL do repo remoto; vazio = deploy por push

while [[ $# -gt 0 ]]; do
    case "$1" in
        --chave)             CHAVE_SSH="${2:?--chave precisa do conteúdo da chave pública}"; shift 2 ;;
        --chave-arquivo)     CHAVE_SSH="$(cat "${2:?--chave-arquivo precisa do caminho}")"; shift 2 ;;
        --usuario)           USUARIO="${2:?}"; shift 2 ;;
        --senha)             SENHA="${2:?}"; shift 2 ;;
        --node)              NODE_MAJOR="${2:?}"; shift 2 ;;
        --php)               PHP_VER="${2:?}"; shift 2 ;;
        --porta-ssh)         PORTA_SSH="${2:?}"; shift 2 ;;
        --mysql)             INSTALAR_MYSQL="sim"; shift ;;
        --banco)             BANCO="${2:?--banco precisa do nome do banco}"; INSTALAR_MYSQL="sim"; shift 2 ;;
        --api)               API="${2:?--api precisa do nome do serviço}"; shift 2 ;;
        --api-dominio)       API_DOMINIO="${2:?}"; shift 2 ;;
        --api-porta)         API_PORTA="${2:?}"; shift 2 ;;
        --api-branch)        API_BRANCH="${2:?}"; shift 2 ;;
        --api-git)           API_GIT="${2:?--api-git precisa da URL do repositório}"; shift 2 ;;
        --app)               APP="${2:?--app precisa do nome do projeto}"; shift 2 ;;
        --dominio)           DOMINIO="${2:?}"; shift 2 ;;
        --branch)            BRANCH="${2:?}"; shift 2 ;;
        --ssl)               RODAR_SSL="sim"; shift ;;
        --manter-senha-ssh)  MANTER_SENHA_SSH="sim"; shift ;;
        --pular-base)        PULAR_BASE="sim"; shift ;;
        # Imprime o cabeçalho até a primeira linha que não é comentário, em vez
        # de um intervalo fixo de linhas: assim o --help não passa a mentir na
        # primeira vez que alguém acrescentar três linhas lá em cima.
        -h|--help)           awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
        *) echo "Opção desconhecida: $1 (use --help)" >&2; exit 2 ;;
    esac
done

# ------------------------------------------------------------------ utilidades

VERDE=$'\033[0;32m'; AMARELO=$'\033[0;33m'; VERMELHO=$'\033[0;31m'; NEUTRO=$'\033[0m'
AVISOS=()

etapa() { printf '\n%s==> %s%s\n' "$VERDE" "$1" "$NEUTRO"; }
ok()    { printf '    %s\n' "$1"; }
aviso() { printf '    %s! %s%s\n' "$AMARELO" "$1" "$NEUTRO"; AVISOS+=("$1"); }
erro()  { printf '\n%sERRO: %s%s\n' "$VERMELHO" "$1" "$NEUTRO" >&2; exit 1; }

# Com --pular-base o script não olha o SSH, então não pode afirmar nada sobre
# ele no resumo. Dizer "senha LIGADA · chave AUSENTE" quando ninguém conferiu é
# pior que não dizer nada: manda a pessoa consertar um problema que talvez não
# exista, num servidor que está certo.
resumo_ssh() {
    if [[ "${DESLIGAR_SENHA:-?}" == "?" ]]; then
        echo "não verificado (--pular-base)"
    else
        printf 'senha %s · chave %s' \
            "$([[ "$DESLIGAR_SENHA" == "sim" ]] && echo DESLIGADA || echo LIGADA)" \
            "$([[ "$TEM_CHAVE" == "sim" ]] && echo instalada || echo AUSENTE)"
    fi
}

[[ $EUID -eq 0 ]] || erro "rode como root (sudo ./provision-ubuntu.sh)"
[[ -f /etc/os-release ]] || erro "não parece um Ubuntu"
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || aviso "distro é '${ID:-?}', não ubuntu — pode dar diferença"
[[ -n "$APP" && ! "$APP" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && erro "--app aceita letras, números, - e _ (sem espaço, acento ou barra)"
[[ -n "$API" && ! "$API" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && erro "--api aceita letras, números, - e _ (sem espaço, acento ou barra)"

# O nome do banco entra numa instrução SQL montada por concatenação. Um nome com
# aspa, ponto e vírgula ou hífen viraria SQL quebrado (ou pior). Identificador de
# MySQL sem crase aceita letras, números e underscore — é o que se exige aqui.
[[ -n "$BANCO" && ! "$BANCO" =~ ^[A-Za-z][A-Za-z0-9_]{0,31}$ ]] && erro "--banco aceita letras, números e _ (até 32 caracteres, começando por letra)"

[[ -n "$API" && -z "$BANCO" ]] && aviso "--api sem --banco: o .env da API vai precisar das credenciais do banco na mão"

# Instalação de pacote sem NENHUMA pergunta: sem prompt de conffile, sem a tela
# roxa do needrestart perguntando quais serviços reiniciar (que trava o script
# em execução desatendida no 24.04).
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

instalar() { apt-get install "${APT_OPTS[@]}" "$@"; }

# Todo download tem timeout e retry. Sem `--connect-timeout`, um VPS cujo DNS
# devolve AAAA sem rota IPv6 de verdade deixa o curl pendurado por minutos sem
# imprimir NADA — é o jeito mais comum de um passo "travar" sem mensagem. Onde a
# rede pode falhar, o script tenta de novo forçando IPv4.
CURL=(curl -fsSL --connect-timeout 10 --max-time 180 --retry 3 --retry-connrefused)

# Baixa uma URL tentando IPv6+IPv4 e, se falhar, só IPv4. Devolve 1 se não deu.
baixar() {
    local url="$1" destino="$2" args
    for flag in "" "-4"; do
        args=("${CURL[@]}")
        [[ -n "$flag" ]] && args+=("$flag")
        if "${args[@]}" "$url" -o "$destino"; then
            return 0
        fi
        [[ -z "$flag" ]] && aviso "download de ${url} falhou — tentando de novo só por IPv4"
    done
    return 1
}

# =====================================================================
#  BASE — pacotes, usuário, SSH, Node, Python, firewall, nginx, redis
#
#  Com --pular-base tudo isto é saltado: é o modo para um servidor que já
#  passou por aqui e só precisa de uma camada nova (um banco, uma API).
#  Rodar a base de novo não quebraria nada — ela é idempotente —, mas leva
#  minutos fazendo apt upgrade e recarregando o SSH à toa.
#
#  O bloco abaixo continua sem indentar de propósito: indentar 320 linhas
#  só para caber num `else` transformaria um diff de duas linhas num de
#  trezentas, e ninguém revisaria.
# =====================================================================

if [[ "$PULAR_BASE" == "sim" ]]; then
    etapa "Base"
    ok "pulada (--pular-base) — assumindo servidor já provisionado"

    # Sem a base, as camadas abaixo dependem do que já está instalado.
    # Descobrir isso agora é melhor que descobrir no meio do deploy, com um
    # "command not found" saindo de dentro de um hook do git.
    FALTANDO=()
    for cmd in git nginx node npm openssl curl; do
        command -v "$cmd" >/dev/null 2>&1 || FALTANDO+=("$cmd")
    done
    if [[ ${#FALTANDO[@]} -gt 0 ]]; then
        erro "faltam no servidor: ${FALTANDO[*]}. Rode uma vez sem --pular-base."
    fi

    id -u "$USUARIO" >/dev/null 2>&1         || erro "o usuário '${USUARIO}' não existe. Rode uma vez sem --pular-base."

    # Estes dois só são calculados pela base, e o resumo lá embaixo os imprime.
    TEM_CHAVE="?"
    DESLIGAR_SENHA="?"
else

# --------------------------------------------------- 1. pacotes base do sistema

etapa "Pacotes base"

# Em imagem de nuvem recém-criada o cloud-init ainda está mexendo no apt: sem
# esperar, o primeiro apt-get morre com "Could not get lock".
if command -v cloud-init >/dev/null 2>&1; then
    ok "esperando o cloud-init terminar…"
    cloud-init status --wait >/dev/null 2>&1 || true
fi

apt-get update -y
apt-get upgrade "${APT_OPTS[@]}"
instalar ca-certificates curl gnupg lsb-release apt-transport-https \
         software-properties-common sudo git unzip zip htop rsync jq acl cron openssl
systemctl enable --now cron >/dev/null 2>&1 || true
ok "sistema atualizado"

# ------------------------------------------------------------ 2. usuário ubuntu

etapa "Usuário $USUARIO"

if id -u "$USUARIO" >/dev/null 2>&1; then
    ok "usuário já existe"
else
    adduser --disabled-password --gecos "" "$USUARIO"
    ok "usuário criado"
fi

echo "${USUARIO}:${SENHA}" | chpasswd
usermod -aG sudo "$USUARIO"
usermod -s /bin/bash "$USUARIO"
ok "senha definida e usuário no grupo sudo"

# sudo sem pedir senha. É o que faz "acesso sem senha" valer também depois do
# login — com a senha do SSH desligada, um sudo que pede senha transforma
# qualquer automação (inclusive o hook de deploy) num prompt travado.
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$USUARIO" > "/etc/sudoers.d/90-${USUARIO}"
chmod 0440 "/etc/sudoers.d/90-${USUARIO}"
visudo -cf "/etc/sudoers.d/90-${USUARIO}" >/dev/null || erro "sudoers inválido"
ok "sudo sem senha"

if [[ "$SENHA" == "ubuntu" ]]; then
    aviso "a senha do usuário é 'ubuntu' — trivial de adivinhar. Só não é um buraco aberto porque o SSH por senha fica DESLIGADO abaixo; se um dia religar a senha, troque antes."
fi

# ------------------------------------------------------------------- 3. chaves

etapa "Chave SSH"

CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "${CASA}/.ssh"
AUTH="${CASA}/.ssh/authorized_keys"
touch "$AUTH"

# Se não veio chave por parâmetro, herda a que já está no servidor: em imagem de
# nuvem ela costuma estar em /root/.ssh/authorized_keys (é por ela que você
# entrou como root agora).
if [[ -z "$CHAVE_SSH" ]]; then
    for origem in /root/.ssh/authorized_keys "$AUTH"; do
        if [[ -s "$origem" ]] && grep -qE '^(ssh-(rsa|ed25519)|ecdsa-sha2-)' "$origem"; then
            CHAVE_SSH="$(grep -E '^(ssh-(rsa|ed25519)|ecdsa-sha2-)' "$origem")"
            ok "reaproveitando a(s) chave(s) de ${origem}"
            break
        fi
    done
fi

if [[ -n "$CHAVE_SSH" ]]; then
    while IFS= read -r linha; do
        [[ -n "$linha" ]] || continue
        grep -qxF "$linha" "$AUTH" || echo "$linha" >> "$AUTH"
    done <<< "$CHAVE_SSH"
    ok "chave(s) instalada(s) em $AUTH"
fi

chmod 0600 "$AUTH"
chown -R "${USUARIO}:${USUARIO}" "${CASA}/.ssh"

TEM_CHAVE="nao"
grep -qE '^(ssh-(rsa|ed25519)|ecdsa-sha2-)' "$AUTH" && TEM_CHAVE="sim"

# ------------------------------------------------------------- 4. SSH endurecido

etapa "Configuração do SSH"

DESLIGAR_SENHA="sim"
if [[ "$TEM_CHAVE" != "sim" ]]; then
    DESLIGAR_SENHA="nao"
    aviso "NENHUMA chave pública encontrada — o login por senha foi MANTIDO para você não ficar trancado do lado de fora. Instale a chave e rode de novo: ssh-copy-id ${USUARIO}@ESTE_SERVIDOR"
elif [[ "$MANTER_SENHA_SSH" == "sim" ]]; then
    DESLIGAR_SENHA="nao"
    ok "login por senha mantido a pedido (--manter-senha-ssh)"
fi

# ARMADILHA Nº 1: no sshd, para cada diretiva vale o PRIMEIRO valor lido, não o
# último — ao contrário de quase todo arquivo de configuração. Como o
# `Include /etc/ssh/sshd_config.d/*.conf` fica no TOPO do sshd_config e os
# drop-ins são lidos em ordem alfabética, o `50-cloud-init.conf` das imagens de
# nuvem (que traz "PasswordAuthentication yes") vence tanto um arquivo 99-*
# quanto uma linha escrita à mão lá embaixo no sshd_config. Você desliga a
# senha, o sshd recarrega sem reclamar, e a senha continua ligada.
# Por isso: nosso arquivo é 00- (lido primeiro) E o do cloud-init é neutralizado.
DROPIN=/etc/ssh/sshd_config.d/00-padrao.conf
install -d -m 0755 /etc/ssh/sshd_config.d

{
    echo "# Gerado por provision-ubuntu.sh — não editar à mão."
    echo "Port ${PORTA_SSH}"
    echo "PubkeyAuthentication yes"
    echo "AuthorizedKeysFile .ssh/authorized_keys"
    echo "PermitRootLogin prohibit-password"
    echo "KbdInteractiveAuthentication no"
    echo "PermitEmptyPasswords no"
    # UsePAM fica YES de propósito. É PAM que monta a sessão (limites, motd,
    # sessão do systemd) e checa conta expirada/bloqueada; com "no" o Ubuntu
    # entrega logins pela metade e, dependendo da build, nenhum login.
    # Desligar a senha é papel do PasswordAuthentication, não do UsePAM.
    echo "UsePAM yes"
    echo "X11Forwarding no"
    echo "MaxAuthTries 4"
    echo "LoginGraceTime 30"
    echo "ClientAliveInterval 300"
    echo "ClientAliveCountMax 2"
    if [[ "$DESLIGAR_SENHA" == "sim" ]]; then
        echo "PasswordAuthentication no"
        echo "AuthenticationMethods publickey"
    else
        echo "PasswordAuthentication yes"
    fi
} > "$DROPIN"
chmod 0644 "$DROPIN"

if [[ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ]]; then
    sed -i 's/^[[:space:]]*PasswordAuthentication/#&/' /etc/ssh/sshd_config.d/50-cloud-init.conf
    ok "50-cloud-init.conf neutralizado"
fi

# Valida ANTES de recarregar: sshd_config quebrado + reload = servidor sem SSH.
if ! sshd -t; then
    rm -f "$DROPIN"
    erro "configuração de SSH inválida — arquivo removido, nada foi aplicado"
fi

systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh
if systemctl is-enabled ssh.socket >/dev/null 2>&1 && [[ "$PORTA_SSH" != "22" ]]; then
    aviso "este Ubuntu ativa o SSH por socket (ssh.socket): a porta ${PORTA_SSH} exige também 'systemctl edit ssh.socket' com ListenStream=${PORTA_SSH}"
fi
ok "SSH recarregado (senha: $([[ "$DESLIGAR_SENHA" == "sim" ]] && echo DESLIGADA || echo ligada))"

# ------------------------------------------------------------------- 5. Node.js

etapa "Node.js ${NODE_MAJOR}.x"

if command -v node >/dev/null 2>&1 && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
    ok "já instalado: $(node -v)"
else
    baixar "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" /tmp/nodesource.sh \
        || erro "não consegui baixar o script do NodeSource. Confira DNS/saída da VPS e rode de novo — o script retoma daqui."
    bash /tmp/nodesource.sh
    rm -f /tmp/nodesource.sh
    instalar nodejs
    ok "instalado: $(node -v) / npm $(npm -v)"
fi

command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 || true

# ------------------------------------------------------------------- 6. Python

etapa "Python 3"

# python-is-python3: no Ubuntu o binário é `python3` e o comando `python` NÃO
# existe. Sem este pacote, todo script (e toda pessoa) que chama `python` leva
# "command not found" numa máquina que tem Python instalado.
instalar python3 python3-pip python3-venv python3-dev python3-setuptools \
         python-is-python3 build-essential pipx
ok "instalado: $(python3 --version)"

# PEP 668: no 22.04+ o pip global recusa instalar ("externally-managed
# environment"). pipx e venv são os caminhos que funcionam.
sudo -u "$USUARIO" -H bash -lc 'pipx ensurepath >/dev/null 2>&1' || true
ok "pipx pronto (o pip global é bloqueado pelo PEP 668 — use venv ou pipx)"

# --------------------------------------------------------------- 7. firewall UFW

etapa "Firewall (UFW)"

instalar ufw

# A regra do SSH ENTRA ANTES do enable. Na ordem contrária, o 'ufw enable'
# derruba a sua própria sessão e o servidor fica inalcançável.
ufw allow "${PORTA_SSH}/tcp" comment 'SSH'      >/dev/null
ufw allow 80/tcp             comment 'HTTP'     >/dev/null
ufw allow 443/tcp            comment 'HTTPS'    >/dev/null
ufw default deny incoming    >/dev/null
ufw default allow outgoing   >/dev/null
ufw --force enable           >/dev/null
systemctl enable --now ufw   >/dev/null 2>&1 || true
ok "ativo — entrada negada, liberadas ${PORTA_SSH}/80/443"

# -------------------------------------------------------------- 8. fail2ban

etapa "fail2ban"

# ARMADILHA Nº 2: o 24.04 não instala mais o rsyslog, então /var/log/auth.log
# não existe. A jail padrão do sshd aponta para esse arquivo, não acha nada, e o
# fail2ban sobe "ativo" vigiando coisa nenhuma — você acha que está protegido e
# não está. O backend systemd lê do journal; ele precisa do python3-systemd.
instalar fail2ban python3-systemd

cat > /etc/fail2ban/jail.local <<EOF
# Gerado por provision-ubuntu.sh
[DEFAULT]
backend  = systemd
bantime  = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled  = true
port     = ${PORTA_SSH}
maxretry = 4
bantime  = 2h
EOF

systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban
sleep 2
if fail2ban-client status sshd >/dev/null 2>&1; then
    ok "jail sshd ativa (4 tentativas → 2h de ban)"
else
    aviso "fail2ban subiu mas a jail sshd não respondeu — confira: fail2ban-client status sshd"
fi

# ----------------------------------------------------------------- 9. nginx

etapa "nginx"

instalar nginx

# Roda como `ubuntu`: é o que deixa o deploy publicar arquivo sem brigar com
# permissão. A diretiva `user` só vale no contexto principal, então é edição no
# nginx.conf mesmo — não dá para fazer por drop-in.
if grep -qE '^\s*user\s+' /etc/nginx/nginx.conf; then
    sed -i "s|^\s*user\s\+.*;|user ${USUARIO};|" /etc/nginx/nginx.conf
else
    sed -i "1i user ${USUARIO};" /etc/nginx/nginx.conf
fi

# Os workers rodam como `ubuntu`: cache e temporários precisam ser dele, senão o
# nginx sobe e devolve 500 na primeira resposta que precisa de buffer.
install -d -o "$USUARIO" -g "$USUARIO" /var/www
for dir in /var/log/nginx /var/lib/nginx /var/cache/nginx; do
    [[ -d "$dir" ]] && chown -R "${USUARIO}:${USUARIO}" "$dir"
done

# Limites que todo app Laravel acaba precisando (upload e header grande de
# sessão/JWT). Vai em drop-in do http, que aqui funciona.
TUNING=/etc/nginx/conf.d/00-padrao.conf
{
    echo "# Gerado por provision-ubuntu.sh"
    echo "client_max_body_size 64m;"
    echo "server_tokens off;"
    echo "large_client_header_buffers 4 16k;"

    # `gzip` NÃO aceita duplicata no mesmo contexto: o nginx.conf do Ubuntu já
    # traz "gzip on;" dentro do http, e repetir aqui derruba a configuração
    # INTEIRA com "gzip directive is duplicate". Só emite se ainda não existir.
    if ! grep -qE '^[[:space:]]*gzip[[:space:]]+(on|off)[[:space:]]*;' /etc/nginx/nginx.conf; then
        echo "gzip on;"
    fi
    echo "gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;"
} > "$TUNING"

# Se o teste reprovar por causa DESTE arquivo, desfaz e testa de novo. Deixar um
# nginx.conf inválido em disco é pior do que não afinar nada: o serviço continua
# de pé com a config antiga em memória e só morre no próximo reboot — longe
# daqui, sem ninguém ligando uma coisa à outra.
if ! nginx -t >/dev/null 2>&1; then
    rm -f "$TUNING"
    if nginx -t >/dev/null 2>&1; then
        aviso "o ajuste de limites do nginx (00-padrao.conf) foi REMOVIDO por ter reprovado no 'nginx -t'; o resto da configuração está válido"
    fi
fi

if nginx -t >/dev/null 2>&1; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl restart nginx
    ok "rodando como '${USUARIO}'$([[ -z "$APP$API" ]] && echo ' — nenhum vhost criado' || echo '')"
else
    aviso "nginx -t reprovou a configuração e o problema NÃO é do 00-padrao.conf; serviço não foi reiniciado. Rode 'nginx -t' para ver o motivo"
fi

# ----------------------------------------------------------------- 10. redis

etapa "Redis"

instalar redis-server

CONF=/etc/redis/redis.conf
if [[ -f "$CONF" ]]; then
    # supervised systemd: sem isso o systemd não sabe quando o redis ficou
    # pronto e trata reinício como falha.
    if grep -qE '^\s*supervised\s+' "$CONF"; then
        sed -i 's|^\s*supervised\s\+.*|supervised systemd|' "$CONF"
    else
        echo 'supervised systemd' >> "$CONF"
    fi

    # Escuta SÓ local. O UFW já barraria de fora, mas defesa em profundidade é
    # barata aqui: redis sem senha exposto na internet é sequestrado em horas.
    if grep -qE '^\s*bind\s+' "$CONF"; then
        sed -i 's|^\s*bind\s\+.*|bind 127.0.0.1 -::1|' "$CONF"
    else
        echo 'bind 127.0.0.1 -::1' >> "$CONF"
    fi
fi

systemctl enable redis-server >/dev/null 2>&1 || true
systemctl restart redis-server
sleep 1
if redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "respondendo em 127.0.0.1:6379"
else
    aviso "redis não respondeu ao ping — confira: systemctl status redis-server"
fi

fi   # fim da base


# =====================================================================
#  CAMADA MYSQL — só com --mysql ou --banco
# =====================================================================

SENHA_BANCO=""

if [[ "$INSTALAR_MYSQL" != "sim" ]]; then
    etapa "MySQL"
    ok "pulado (rode de novo com --banco NOME para instalar o servidor e criar o banco)"
else

etapa "MySQL server"

instalar mysql-server mysql-client

# Escuta SÓ local, como o redis. O banco desta VPS serve a API que roda na
# própria VPS — não há motivo para ele atender a internet, e MySQL exposto é
# alvo de varredura automatizada no mesmo dia em que a porta abre.
#
# Drop-in em vez de editar o mysqld.cnf: assim um upgrade do pacote não
# sobrescreve o ajuste nem abre prompt de conffile.
install -d -m 0755 /etc/mysql/mysql.conf.d
cat > /etc/mysql/mysql.conf.d/99-padrao.cnf <<'EOF'
# Gerado por provision-ubuntu.sh
[mysqld]
bind-address            = 127.0.0.1
mysqlx-bind-address     = 127.0.0.1

character-set-server    = utf8mb4
collation-server        = utf8mb4_unicode_ci

# O app manda e recebe tudo em UTC e converte na borda. Deixar o servidor no
# fuso do sistema faria DATETIME gravado por um processo e lido por outro
# divergir quando a VPS mudasse de fuso — inclusive no horário de verão.
default-time-zone       = '+00:00'

# Conexão ociosa presa por 8 horas (o padrão) segura slot à toa quando o pool
# do Node reconecta. 10 minutos é folgado para um app web.
wait_timeout            = 600
interactive_timeout     = 600

max_connections         = 100
EOF

systemctl enable mysql >/dev/null 2>&1 || true
systemctl restart mysql

# O MySQL leva alguns segundos para aceitar conexão depois do restart. Sem
# esperar, o primeiro `mysql -e` falha com "Can't connect" e o script morre
# num ponto que parece erro de permissão.
PRONTO="nao"
for _ in $(seq 1 30); do
    if mysqladmin ping >/dev/null 2>&1; then PRONTO="sim"; break; fi
    sleep 1
done
[[ "$PRONTO" == "sim" ]] || erro "MySQL não respondeu em 30s — veja 'journalctl -u mysql -n 50'"

ok "$(mysql --version | awk '{print $1, $3}') — escutando só em 127.0.0.1"

# --------------------------------------------------------------- endurecimento

# O equivalente ao mysql_secure_installation, só que em SQL e sem prompt.
#
# O root do pacote Ubuntu usa auth_socket: ele só entra pelo socket unix, como
# o usuário root do sistema. Isso já é mais seguro que senha — e é por isso que
# este script consegue rodar SQL como root sem senha nenhuma. NÃO troque para
# mysql_native_password "para facilitar": aí o root passa a ser adivinhável.
mysql --protocol=socket <<'SQL'
-- Usuário anônimo entra sem senha e enxerga o banco `test`. Some com os dois.
DROP USER IF EXISTS ''@'localhost';
DROP USER IF EXISTS ''@'%';
DROP DATABASE IF EXISTS test;
-- root remoto não deve existir; se a imagem trouxe um, vai embora.
DROP USER IF EXISTS 'root'@'%';
FLUSH PRIVILEGES;
SQL
ok "anônimos, base 'test' e root remoto removidos"

# ---------------------------------------------------------- banco da aplicação

if [[ -n "$BANCO" ]]; then

    CRED="/root/mysql-${BANCO}.txt"

    # A senha é gerada UMA vez. Nas execuções seguintes ela é relida do arquivo
    # — se fosse sorteada de novo a cada run, todo re-provisionamento trocaria a
    # senha do banco e derrubaria o app que já está no ar, com um erro de
    # autenticação que ninguém liga ao script que acabou de rodar.
    if [[ -f "$CRED" ]] && grep -q '^DB_SENHA=' "$CRED"; then
        SENHA_BANCO="$(sed -n 's/^DB_SENHA=//p' "$CRED" | head -1)"
        ok "senha existente reaproveitada de ${CRED}"
    else
        # hex e não base64: sem /, + ou = para atrapalhar .env, URL de conexão
        # ou aspas de shell. 32 bytes = 256 bits de entropia.
        SENHA_BANCO="$(openssl rand -hex 32)"
        ok "senha nova gerada"
    fi

    # A senha vai pelo STDIN (heredoc), nunca como argumento de linha de
    # comando. `mysql -p$SENHA` deixaria a senha visível no `ps` para qualquer
    # usuário da máquina enquanto o comando roda — é o vazamento clássico de
    # script de provisionamento.
    #
    # E ela é hexadecimal por construção (openssl rand -hex): sem aspa, barra
    # ou ponto e vírgula, ela não tem como escapar das aspas simples do
    # IDENTIFIED BY. Se um dia trocar o gerador por algo com símbolos, este
    # trecho precisa passar a escapar.
    #
    # O usuário fica em 'localhost' de propósito: com '%' ele poderia entrar de
    # qualquer lugar caso o bind-address um dia mude. Aqui, nem que mude.
    mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS \`${BANCO}\`
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '${BANCO}'@'localhost' IDENTIFIED BY '${SENHA_BANCO}';
ALTER USER '${BANCO}'@'localhost' IDENTIFIED BY '${SENHA_BANCO}';

-- Sem GRANT ALL global: só neste banco. Um app comprometido não enxerga os
-- outros bancos da instância nem consegue criar usuário.
GRANT ALL PRIVILEGES ON \`${BANCO}\`.* TO '${BANCO}'@'localhost';
FLUSH PRIVILEGES;
SQL

    umask 077
    cat > "$CRED" <<EOF
# Gerado por provision-ubuntu.sh em $(date '+%F %T')
# Credenciais do banco '${BANCO}'. Este arquivo é 0600 e só o root lê.
DB_HOST=127.0.0.1
DB_PORTA=3306
DB_USUARIO=${BANCO}
DB_SENHA=${SENHA_BANCO}
DB_NOME=${BANCO}
EOF
    chmod 0600 "$CRED"
    umask 022

    # Confere que dá para entrar DE VERDADE com o usuário criado. Sem este
    # teste, um erro de plugin de autenticação só apareceria no primeiro deploy,
    # como "Access denied" — longe daqui e sem ninguém ligando uma coisa à outra.
    if MYSQL_PWD="$SENHA_BANCO" mysql -h 127.0.0.1 -u "$BANCO" -D "$BANCO" -e 'SELECT 1' >/dev/null 2>&1; then
        ok "banco '${BANCO}' criado e testado — credenciais em ${CRED}"
    else
        aviso "o banco '${BANCO}' foi criado mas o login de teste falhou. Confira: mysql -h 127.0.0.1 -u ${BANCO} -p"
    fi

    # Backup diário. O Supabase (ou o RDS) fazia isto por você; numa VPS, não
    # faz ninguém. Um banco sem cópia é uma questão de tempo, não de sorte.
    install -d -m 0700 /var/backups/mysql
    cat > /etc/cron.daily/backup-${BANCO} <<EOF
#!/bin/sh
# Gerado por provision-ubuntu.sh
set -e
ARQ="/var/backups/mysql/${BANCO}-\$(date +%F).sql.gz"

# Roda como root do sistema, que entra no MySQL pelo socket (auth_socket) —
# por isso não há senha nenhuma escrita aqui.
#
# --single-transaction: dump consistente sem travar a escrita (InnoDB).
mysqldump --protocol=socket --single-transaction \\
          --routines --triggers --databases ${BANCO} | gzip > "\$ARQ"
chmod 0600 "\$ARQ"

find /var/backups/mysql -name '${BANCO}-*.sql.gz' -mtime +14 -delete
EOF
    chmod 0700 /etc/cron.daily/backup-${BANCO}
    ok "backup diário em /var/backups/mysql (14 dias de retenção)"
    aviso "o backup fica NO MESMO DISCO do banco — isso não é backup, é uma segunda cópia do mesmo risco. Configure envio para fora da VPS (rclone, scp, S3)."
fi

fi   # fim da camada MySQL

# =====================================================================
#  CAMADA API NODE — só com --api
# =====================================================================

if [[ -z "$API" ]]; then
    etapa "Camada API Node"
    ok "pulada (rode de novo com --api NOME para publicar um serviço Node/Nest)"
else

API_RAIZ="/var/www/${API}"
API_ATUAL="${API_RAIZ}/current"
API_REPO="/var/repo/${API}.git"
API_ENV="${API_ATUAL}/.env"
API_PUBLICAR="/usr/local/bin/publicar-${API}"

# Dois modos de deploy, e SÓ UM por vez:
#
#   bare — você dá push direto para a VPS. Não depende do GitHub estar de pé
#          nem de chave de deploy. É o mais simples, e o que funciona quando a
#          internet da obra está ruim mas o SSH aguenta.
#
#   git  — a VPS clona do GitHub e o deploy é um `git pull`. O que está no ar
#          é sempre um commit que existe no GitHub, o que torna "por que
#          produção está diferente do main?" uma pergunta impossível.
#
# Ter os dois ao mesmo tempo seria a pior combinação: duas fontes da verdade
# sobre o que está publicado, e um push para o bare sumiria do histórico do
# GitHub sem ninguém notar. Por isso --api-git desliga o bare.
if [[ -n "$API_GIT" ]]; then
    API_MODO="git"
else
    API_MODO="bare"
fi

etapa "API Node: ${API} (deploy por ${API_MODO})"

install -d -o "$USUARIO" -g "$USUARIO" "$API_ATUAL"
install -d -o "$USUARIO" -g "$USUARIO" /var/log/deploy

if [[ "$API_MODO" == "bare" ]]; then
    install -d -o "$USUARIO" -g "$USUARIO" /var/repo

    # Vindo de um provisionamento anterior com --api-git, sobra aqui o .git
    # que aquele modo criou. Ele não atrapalha o checkout (que usa --git-dir
    # explícito), mas faz `git log` dentro do diretório responder pelo
    # repositório errado — o antigo, vazio — e a linha do commit publicado
    # sairia mentindo.
    if [[ -d "${API_ATUAL}/.git" ]]; then
        rm -rf "${API_ATUAL}/.git"
        ok "removido o .git deixado por um provisionamento no modo git"
    fi

    if [[ ! -d "$API_REPO" ]]; then
        sudo -u "$USUARIO" git init --bare "$API_REPO" >/dev/null
        ok "repositório bare criado em $API_REPO"
    else
        ok "repositório bare já existe"
    fi

    # Mesma armadilha nº 3 da camada Laravel: o HEAD de um bare nasce em `master`.
    sudo -u "$USUARIO" git --git-dir="$API_REPO" symbolic-ref HEAD "refs/heads/${API_BRANCH}"
fi

# ------------------------------------------------------------------ .env da API

# Só é escrito se AINDA NÃO existir. Reescrever aqui apagaria o JWT_SEGREDO em
# uso — e trocar esse segredo derruba a sessão de todo mundo, inclusive a sua,
# num momento que não tem relação nenhuma com o que você foi fazer no servidor.
if [[ -f "$API_ENV" ]]; then
    ok ".env já existe — não foi tocado"
else
    JWT_SEGREDO="$(openssl rand -base64 48 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"

    umask 077
    {
        echo "# Gerado por provision-ubuntu.sh em $(date '+%F %T')"
        echo "PORTA=${API_PORTA}"
        echo ""
        echo "# Origens do front que podem chamar esta API, separadas por vírgula."
        echo "# Precisa ser a origem EXATA: com https://, sem barra no fim."
        echo "# Acrescente aqui o domínio da Vercel depois do primeiro deploy do front."
        echo "ORIGENS_PERMITIDAS=http://localhost:3000"
        echo ""
        if [[ -n "$SENHA_BANCO" ]]; then
            echo "DB_HOST=127.0.0.1"
            echo "DB_PORTA=3306"
            echo "DB_USUARIO=${BANCO}"
            echo "DB_SENHA=${SENHA_BANCO}"
            echo "DB_NOME=${BANCO}"
        else
            echo "# Preencha à mão — este script rodou sem --banco."
            echo "DB_HOST=127.0.0.1"
            echo "DB_PORTA=3306"
            echo "DB_USUARIO="
            echo "DB_SENHA="
            echo "DB_NOME="
        fi
        echo ""
        echo "# Trocar este valor derruba a sessão de todo mundo — que é"
        echo "# exatamente o que você quer se ele algum dia vazar."
        echo "JWT_SEGREDO=${JWT_SEGREDO}"
        echo "JWT_VALIDADE=7d"
        echo ""
        echo "# Vazio enquanto o front estiver num *.vercel.app."
        echo "COOKIE_DOMINIO="
    } > "$API_ENV"
    umask 022

    chmod 0600 "$API_ENV"
    chown "${USUARIO}:${USUARIO}" "$API_ENV"
    ok ".env criado com segredo JWT e credenciais do banco"
fi

# ---------------------------------------------------------------- systemd

# EnvironmentFile e não `Environment=`: assim a senha do banco fica num arquivo
# 0600 em vez de aparecer para qualquer um que rode `systemctl show`.
cat > "/etc/systemd/system/${API}.service" <<UNIT
# Gerado por provision-ubuntu.sh
[Unit]
Description=${API} — API Node
After=network.target mysql.service
Wants=mysql.service

# Estas duas vão em [Unit], e não em [Service] — o systemd ignora (com aviso
# no journal) quando aparecem no lugar errado, e aí o limite simplesmente não
# existe. Sem elas, uma falha na partida (o banco fora do ar, por exemplo)
# vira um laço de reinício a cada 5s que enche o journal e enterra a causa
# original entre milhares de linhas iguais.
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=${USUARIO}
Group=${USUARIO}
WorkingDirectory=${API_ATUAL}
EnvironmentFile=${API_ENV}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${API_RAIZ}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${API}" >/dev/null 2>&1 || true
ok "serviço ${API}.service registrado (porta ${API_PORTA}, usuário ${USUARIO})"

# ---------------------------------------------------- comando de publicação

# Os passos de build, migration e restart moram AQUI, num arquivo só.
#
# Os dois modos de deploy chamam este mesmo comando. Se cada caminho tivesse a
# própria cópia, elas divergiriam no primeiro ajuste — e você acabaria com um
# deploy por push que roda migration e um deploy por pull que não roda, sem
# nada na tela indicando a diferença.
#
# Ele também serve para rodar na mão, que é o que se quer quando o deploy
# falhou e você está no servidor tentando entender o porquê.

cat > "$API_PUBLICAR" <<PUB
#!/usr/bin/env bash
# Gerado por provision-ubuntu.sh — publica a API ${API}.
#
#   publicar-${API}            busca o código novo (modo git) e publica
#   publicar-${API} --local    publica o que JÁ está no diretório
#
set -euo pipefail

APP_DIR="${API_ATUAL}"
GIT_DIR="${API_REPO}"
BRANCH="${API_BRANCH}"
SERVICO="${API}"
PORTA="${API_PORTA}"
MODO="${API_MODO}"
LOG="/var/log/deploy/${API}.log"

# Rodar migration sozinho no deploy é conveniente e é risco: migration
# destrutiva sobe junto com o código, sem ninguém olhando. Deixe 1 se você
# revisa migration antes do push; troque para 0 e rode na mão se não revisa.
RODAR_MIGRATE=1

exec > >(tee -a "\$LOG") 2>&1
echo "===== \$(date '+%F %T') publicação iniciada ====="

cd "\$APP_DIR"

# --local significa "o código novo já está no lugar": é o caso do hook de
# push, que acabou de fazer o checkout.
if [[ "\${1:-}" != "--local" && "\$MODO" == "git" ]]; then
    git fetch --prune origin
    # reset --hard e não merge: diretório de produção não é lugar de resolver
    # conflito. O que vale é o que está no remoto, ponto. Arquivo não
    # rastreado (o .env, o node_modules) sobrevive a isto.
    git reset --hard "origin/\$BRANCH"
fi

# No modo bare o diretório de trabalho NÃO tem .git próprio: o histórico vive
# no repositório bare, e o checkout chega aqui por --work-tree. Perguntar de
# dentro de APP_DIR responderia "not a git repository" e esta linha — a única
# que diz o que foi publicado — sairia vazia bem na hora em que você precisa
# saber qual commit está no ar.
if [[ "\$MODO" == "bare" ]]; then
    COMMIT="\$(git --git-dir="\$GIT_DIR" log -1 --pretty='%h %s' "\$BRANCH" 2>/dev/null || echo desconhecido)"
else
    COMMIT="\$(git log -1 --pretty='%h %s' 2>/dev/null || echo desconhecido)"
fi
echo ">> commit \$COMMIT"

if [[ ! -f .env ]]; then
    echo ">> .env AUSENTE em \$APP_DIR — código publicado, build e migration pulados."
    exit 0
fi

# npm ci e não npm install: instala exatamente o que está no package-lock.json.
# 'npm install' pode resolver uma versão diferente da que você testou, e a
# diferença só aparece em produção.
#
# COM as devDependencies: o build precisa do @nestjs/cli e do typescript, que
# são devDependencies. Podar vem depois do build.
npm ci --no-audit --no-fund

npm run build

if [[ "\$RODAR_MIGRATE" == "1" ]]; then
    npm run migracao:rodar
fi

# Agora sim: fora o que só servia para compilar. Menos código em disco rodando
# como o dono do deploy.
npm prune --omit=dev

# O Node carregou o dist/ na memória e não olha o disco de novo. Sem restart,
# você serve o código ANTIGO indefinidamente. Isto roda como '${USUARIO}',
# então precisa do sudo -n — sem ele falharia calado.
sudo -n systemctl restart "\$SERVICO"

# Espera responder antes de dizer que deu certo. Sem isto, um deploy que sobe
# código quebrado é reportado como sucesso e você descobre pelo cliente.
sleep 3
for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 "http://127.0.0.1:\${PORTA}/api/saude" >/dev/null 2>&1; then
        echo "===== \$(date '+%F %T') publicado — API respondendo ====="
        exit 0
    fi
    sleep 2
done

echo ">> A API NÃO respondeu em /api/saude depois do restart."
echo ">> Veja o motivo: sudo journalctl -u \$SERVICO -n 50 --no-pager"
exit 1
PUB

chmod 0755 "$API_PUBLICAR"
chown "${USUARIO}:${USUARIO}" /var/log/deploy
ok "comando de publicação instalado: ${API_PUBLICAR}"

# ------------------------------------------------------------ modo de deploy

if [[ "$API_MODO" == "bare" ]]; then

    # O hook ficou fino de propósito: ele só decide SE publica e põe o código
    # no lugar. O que publicar significa está no comando acima.
    cat > "${API_REPO}/hooks/post-receive" <<HOOK
#!/usr/bin/env bash
# Gerado por provision-ubuntu.sh — hook de deploy da API ${API}.
set -euo pipefail

# Só publica o branch configurado: push de outro branch (ou de tag) não pode
# derrubar produção.
PUBLICAR=0
while read -r _antigo _novo ref; do
    [[ "\$ref" == "refs/heads/${API_BRANCH}" ]] && PUBLICAR=1
done
if [[ \$PUBLICAR -eq 0 ]]; then
    echo "nenhum push para ${API_BRANCH} — nada a publicar."
    exit 0
fi

git --work-tree="${API_ATUAL}" --git-dir="${API_REPO}" checkout -f "${API_BRANCH}"

exec ${API_PUBLICAR} --local
HOOK

    chmod +x "${API_REPO}/hooks/post-receive"
    chown -R "${USUARIO}:${USUARIO}" "$API_REPO"
    ok "hook de push instalado (branch: ${API_BRANCH})"

else

    # ------------------------------------------------------- deploy pelo git
    CASA_API="$(getent passwd "$USUARIO" | cut -d: -f6)"
    install -d -m 0700 -o "$USUARIO" -g "$USUARIO" "${CASA_API}/.ssh"

    CHAVE_DEPLOY="${CASA_API}/.ssh/deploy_${API}"
    APELIDO="deploy-${API}"
    MOSTRAR_CHAVE="nao"

    # A URL vira um apelido de SSH em vez de usar github.com direto. Assim a
    # chave de deploy vale SÓ para este repositório: se o usuário `ubuntu`
    # tiver outra chave para o GitHub, uma não atropela a outra.
    if [[ "$API_GIT" =~ ^git@([^:]+):(.+)$ ]]; then
        GIT_HOST="${BASH_REMATCH[1]}"
        GIT_CAMINHO="${BASH_REMATCH[2]}"
        API_GIT_URL="${APELIDO}:${GIT_CAMINHO}"

        if [[ ! -f "$CHAVE_DEPLOY" ]]; then
            sudo -u "$USUARIO" ssh-keygen -t ed25519 -N "" \
                -C "deploy ${API} em $(hostname)" -f "$CHAVE_DEPLOY" >/dev/null
            ok "chave de deploy gerada em ${CHAVE_DEPLOY}"
            MOSTRAR_CHAVE="sim"
        else
            ok "chave de deploy já existe"
        fi

        CONF_SSH="${CASA_API}/.ssh/config"
        touch "$CONF_SSH"
        if ! grep -q "^Host ${APELIDO}\$" "$CONF_SSH"; then
            cat >> "$CONF_SSH" <<SSHCONF

# Gerado por provision-ubuntu.sh — chave de deploy do ${API}
Host ${APELIDO}
    HostName ${GIT_HOST}
    User git
    IdentityFile ${CHAVE_DEPLOY}
    IdentitiesOnly yes
SSHCONF
            ok "apelido SSH '${APELIDO}' configurado"
        fi
        chmod 0600 "$CONF_SSH"
        chown -R "${USUARIO}:${USUARIO}" "${CASA_API}/.ssh"

        # Sem a chave do host em known_hosts, o git para perguntando
        # "Are you sure you want to continue connecting?" — e num hook ou num
        # cron essa pergunta é um processo travado para sempre.
        #
        # Isto é confiança no primeiro uso: estou aceitando a chave que o
        # servidor apresentar agora. Para uma VPS nova falando com o GitHub o
        # risco é pequeno, mas não é zero — confira em
        # https://docs.github.com/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
        KNOWN="${CASA_API}/.ssh/known_hosts"
        touch "$KNOWN"
        if ! sudo -u "$USUARIO" ssh-keygen -F "$GIT_HOST" -f "$KNOWN" >/dev/null 2>&1; then
            ssh-keyscan -t rsa,ecdsa,ed25519 "$GIT_HOST" >> "$KNOWN" 2>/dev/null || true
            chown "${USUARIO}:${USUARIO}" "$KNOWN"
            ok "chave de host de ${GIT_HOST} registrada em known_hosts"
        fi

    elif [[ "$API_GIT" =~ ^https:// ]]; then
        # HTTPS só serve para repositório público: um privado pediria usuário e
        # senha, e a pergunta trava o deploy sem dar sinal.
        API_GIT_URL="$API_GIT"
        aviso "--api-git por HTTPS só funciona com repositório PÚBLICO. Sendo privado, use a URL SSH (git@github.com:usuario/repo.git) para o script gerar uma chave de deploy."
    else
        erro "--api-git não reconhecida: '${API_GIT}'. Use git@github.com:usuario/repo.git ou https://github.com/usuario/repo.git"
    fi

    # init + fetch + reset, e não `git clone`: o clone exige diretório vazio, e
    # neste aqui o .env já foi criado alguns passos acima. Assim também é
    # idempotente — rodar de novo só atualiza o remote.
    if [[ ! -d "${API_ATUAL}/.git" ]]; then
        sudo -u "$USUARIO" git init -q -b "$API_BRANCH" "$API_ATUAL"
    fi
    sudo -u "$USUARIO" git -C "$API_ATUAL" remote remove origin >/dev/null 2>&1 || true
    sudo -u "$USUARIO" git -C "$API_ATUAL" remote add origin "$API_GIT_URL"
    ok "origin apontando para ${API_GIT_URL}"

    if [[ "$MOSTRAR_CHAVE" == "sim" ]]; then
        printf '\n%s    Adicione esta chave ao GitHub antes de continuar:%s\n' "$AMARELO" "$NEUTRO"
        printf '    Settings > Deploy keys > Add deploy key  (NÃO precisa de write access)\n\n'
        sed 's/^/        /' "${CHAVE_DEPLOY}.pub"
        printf '\n'
    fi

    # Tenta buscar já. Falhando (chave ainda não cadastrada, que é o normal na
    # primeira vez), avisa e segue — o resto do provisionamento não depende
    # disto, e obrigar você a rodar tudo de novo por causa de um passo manual
    # seria hostilidade gratuita.
    if sudo -u "$USUARIO" git -C "$API_ATUAL" fetch --prune origin "$API_BRANCH" >/dev/null 2>&1; then
        ok "código buscado do repositório remoto"

        if sudo -u "$USUARIO" "$API_PUBLICAR" >/dev/null 2>&1; then
            ok "primeira publicação concluída — API no ar"
        else
            aviso "o código foi buscado mas a publicação falhou. Veja: tail -50 /var/log/deploy/${API}.log"
        fi
    else
        aviso "não consegui buscar do repositório remoto — quase sempre é a chave de deploy ainda não cadastrada no GitHub. Cadastre e rode: sudo -u ${USUARIO} ${API_PUBLICAR}"
    fi
fi

# ------------------------------------------------------------------ vhost

API_SERVER_NAME="${API_DOMINIO:-_}"
API_VHOST="/etc/nginx/sites-available/${API}"

# O certbot EDITA este arquivo: é nele que ele injeta o bloco 443, o caminho
# do certificado e o redirect de 80 para 443. Sobrescrever sem olhar apaga
# tudo isso — o script diz "vhost ativo", o nginx recarrega sem reclamar, e a
# API volta a atender só em HTTP puro. Ninguém liga uma coisa à outra, porque
# o provisionamento "deu certo".
#
# Então: existindo TLS aqui, o arquivo é deixado em paz.
if [[ -f "$API_VHOST" ]] && grep -q "ssl_certificate" "$API_VHOST"; then
    ok "vhost já tem TLS configurado — preservado (apague o arquivo para forçar reescrita)"

    # Só que preservar também congela porta e domínio. Se algum deles mudou
    # nesta execução, o vhost antigo continua valendo e a mudança some sem
    # aviso — o que é pior que o clobber, porque é silencioso.
    if ! grep -q "127.0.0.1:${API_PORTA}" "$API_VHOST"; then
        aviso "o vhost preservado NÃO aponta para a porta ${API_PORTA}. Ajuste ${API_VHOST} à mão, ou apague o arquivo e rode de novo com --ssl."
    fi
    if [[ -n "$API_DOMINIO" ]] && ! grep -q "server_name.*${API_DOMINIO}" "$API_VHOST"; then
        aviso "o vhost preservado NÃO atende ${API_DOMINIO}. Ajuste ${API_VHOST} à mão, ou apague o arquivo e rode de novo com --ssl."
    fi
else

cat > "$API_VHOST" <<VHOST
# Gerado por provision-ubuntu.sh
server {
    listen 80;
    listen [::]:80;
    server_name ${API_SERVER_NAME};

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:${API_PORTA};
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout 120;
    }

    error_log  /var/log/nginx/${API}-error.log;
    access_log /var/log/nginx/${API}-access.log;
}
VHOST

    ok "vhost escrito"
fi

ln -sfn "$API_VHOST" "/etc/nginx/sites-enabled/${API}"
rm -f /etc/nginx/sites-enabled/default

if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    ok "vhost ativo em ${API_SERVER_NAME} → 127.0.0.1:${API_PORTA}"
else
    aviso "vhost da API reprovado no 'nginx -t' — não recarreguei. Rode 'nginx -t'"
fi

[[ -z "$API_DOMINIO" ]] && aviso "sem --api-dominio o vhost da API usa server_name '_' (pega qualquer host). Defina o domínio antes de expor à internet."

cat > "/etc/logrotate.d/${API}" <<EOF
/var/log/deploy/${API}*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
    su ${USUARIO} ${USUARIO}
}
EOF

if [[ "$RODAR_SSL" == "sim" && -n "$API_DOMINIO" ]]; then
    instalar certbot python3-certbot-nginx
    if certbot --nginx -d "$API_DOMINIO" --non-interactive --agree-tos \
               --register-unsafely-without-email --redirect; then
        ok "certificado emitido para ${API_DOMINIO}"
    else
        aviso "certbot falhou para ${API_DOMINIO} — quase sempre é DNS ainda não apontando para este IP. Rode depois: certbot --nginx -d ${API_DOMINIO}"
    fi
fi

fi   # fim da camada API Node

# =====================================================================
#  CAMADA LARAVEL — só com --app
# =====================================================================

if [[ -z "$APP" ]]; then
    etapa "Camada Laravel"
    ok "pulada (rode de novo com --app NOME para instalar PHP, Composer, deploy e cron)"
else

RAIZ="/var/www/${APP}"
ATUAL="${RAIZ}/current"
REPO="/var/repo/${APP}.git"

# ------------------------------------------------------------ 11. PHP-FPM

etapa "PHP ${PHP_VER} FPM"

# O Ubuntu 24.04 traz PHP 8.3; 8.2 vem do PPA do ondrej.
if ! command -v "php${PHP_VER}" >/dev/null 2>&1; then
    add-apt-repository -y ppa:ondrej/php >/dev/null
    apt-get update -y
fi

instalar "php${PHP_VER}-fpm" "php${PHP_VER}-cli" "php${PHP_VER}-mysql" \
         "php${PHP_VER}-curl" "php${PHP_VER}-xml" "php${PHP_VER}-mbstring" \
         "php${PHP_VER}-zip" "php${PHP_VER}-bcmath" "php${PHP_VER}-intl" \
         "php${PHP_VER}-gd" "php${PHP_VER}-redis" "php${PHP_VER}-opcache"

update-alternatives --set php "/usr/bin/php${PHP_VER}" >/dev/null 2>&1 || true

# O pool roda como `ubuntu`, igual ao nginx. É o que dispensa a dança de
# ubuntu:www-data + chmod 775 em storage/: com o dono, o grupo e o processo
# sendo o mesmo usuário, não há permissão para negociar a cada deploy.
# Contrapartida: um app comprometido roda como o dono do deploy. Com um app por
# VPS isso é aceitável; hospedando vários, crie um usuário por app.
POOL="/etc/php/${PHP_VER}/fpm/pool.d/www.conf"
if [[ -f "$POOL" ]]; then
    sed -i "s|^\s*user\s*=.*|user = ${USUARIO}|"   "$POOL"
    sed -i "s|^\s*group\s*=.*|group = ${USUARIO}|" "$POOL"
    sed -i "s|^\s*listen.owner\s*=.*|listen.owner = ${USUARIO}|" "$POOL"
    sed -i "s|^\s*listen.group\s*=.*|listen.group = ${USUARIO}|" "$POOL"
fi

# Limites que batem com o client_max_body_size do nginx: os três precisam
# concordar, senão o upload morre no meio sem erro legível.
cat > "/etc/php/${PHP_VER}/fpm/conf.d/99-padrao.ini" <<'EOF'
; Gerado por provision-ubuntu.sh
upload_max_filesize = 64M
post_max_size = 64M
memory_limit = 512M
max_execution_time = 120
expose_php = Off
opcache.enable = 1
opcache.memory_consumption = 192
opcache.max_accelerated_files = 20000
opcache.validate_timestamps = 0
EOF

# opcache.validate_timestamps=0 é o que dá o ganho real em produção — e é
# também o que faz código novo NÃO aparecer sem reload do FPM. O hook de deploy
# abaixo recarrega o FPM por isso.
systemctl enable "php${PHP_VER}-fpm" >/dev/null 2>&1 || true
systemctl restart "php${PHP_VER}-fpm"
ok "$(php -v | head -1) — pool como '${USUARIO}', opcache sem revalidar timestamp"

# --------------------------------------------------------- 12. Composer + tools

etapa "Composer e ferramentas"

# Composer roda como root aqui e pergunta se você tem certeza disso — num script
# desatendido essa pergunta é um prompt esperando para sempre.
export COMPOSER_ALLOW_SUPERUSER=1
export COMPOSER_NO_INTERACTION=1
export COMPOSER_HOME=/root/.composer

if ! command -v composer >/dev/null 2>&1; then
    baixar https://getcomposer.org/installer /tmp/composer-setup.php \
        || erro "não consegui baixar o Composer (getcomposer.org inacessível daqui). Rode o script de novo — ele retoma deste ponto."

    # Confere a assinatura oficial: download truncado instala um composer
    # quebrado que só aparece no primeiro deploy, longe daqui.
    SIG=""
    baixar https://composer.github.io/installer.sig /tmp/composer.sig && SIG="$(tr -d '[:space:]' < /tmp/composer.sig)"

    if [[ -n "$SIG" ]]; then
        if ! SIG="$SIG" php -r 'exit(hash_file("sha384", "/tmp/composer-setup.php") === getenv("SIG") ? 0 : 1);'; then
            rm -f /tmp/composer-setup.php /tmp/composer.sig
            erro "instalador do Composer não bate com a assinatura oficial — download corrompido, nada foi instalado"
        fi
    else
        aviso "não deu para conferir a assinatura do instalador do Composer (sig inacessível) — segui mesmo assim"
    fi

    # timeout: se o instalador ficar preso baixando o .phar, o script morre com
    # mensagem em vez de ficar parado a noite toda.
    timeout 300 php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer >/dev/null \
        || erro "instalador do Composer falhou ou expirou (300s)"

    rm -f /tmp/composer-setup.php /tmp/composer.sig
fi
ok "$(timeout 60 composer --version 2>/dev/null | head -1 || echo 'composer instalado (não consegui ler a versão)')"

# Cliente MySQL para conferir o RDS na mão; certbot para o SSL.
instalar default-mysql-client certbot python3-certbot-nginx
ok "mysql-client e certbot instalados"

# ------------------------------------------------------- 13. Estrutura e repo

etapa "Estrutura de diretórios e repositório de deploy"

install -d -o "$USUARIO" -g "$USUARIO" "$ATUAL"
install -d -o "$USUARIO" -g "$USUARIO" /var/repo
install -d -o "$USUARIO" -g "$USUARIO" /var/log/deploy

if [[ ! -d "$REPO" ]]; then
    sudo -u "$USUARIO" git init --bare "$REPO" >/dev/null
    ok "repositório bare criado em $REPO"
else
    ok "repositório bare já existe"
fi

# ARMADILHA Nº 3: `git checkout -f` sem ref usa o HEAD do bare, que nasce
# apontando para `master`. Quem faz push de `main` vê o hook rodar, dar tudo
# certo na tela — e publicar árvore vazia ou a versão errada. Aqui o HEAD é
# fixado no branch escolhido E o hook confere o ref que chegou.
sudo -u "$USUARIO" git --git-dir="$REPO" symbolic-ref HEAD "refs/heads/${BRANCH}"

cat > "${REPO}/hooks/post-receive" <<HOOK
#!/usr/bin/env bash
# Gerado por provision-ubuntu.sh — hook de deploy do ${APP}.
set -euo pipefail

APP_DIR="${ATUAL}"
GIT_DIR="${REPO}"
BRANCH="${BRANCH}"
PHP_FPM="php${PHP_VER}-fpm"
LOG="/var/log/deploy/${APP}.log"

# Rodar migration sozinho no deploy é conveniente e é risco: migration
# destrutiva sobe junto com o código, sem ninguém olhando. Deixe 1 se o time
# revisa migration antes do push; troque para 0 e rode na mão se não revisa.
RODAR_MIGRATE=1

exec > >(tee -a "\$LOG") 2>&1
echo "===== \$(date '+%F %T') deploy iniciado ====="

# Só publica o branch configurado: push de outro branch (ou de tag) não pode
# derrubar produção.
PUBLICAR=0
while read -r _antigo _novo ref; do
    [[ "\$ref" == "refs/heads/\${BRANCH}" ]] && PUBLICAR=1
done
if [[ \$PUBLICAR -eq 0 ]]; then
    echo "nenhum push para \${BRANCH} — nada a publicar."
    exit 0
fi

git --work-tree="\$APP_DIR" --git-dir="\$GIT_DIR" checkout -f "\$BRANCH"
cd "\$APP_DIR"

composer install --no-dev --optimize-autoloader --no-interaction --prefer-dist

# ARMADILHA Nº 4: no PRIMEIRO deploy não existe .env, e todo comando artisan
# morre com "No application encryption key". Sem esta guarda o hook falha no
# meio e deixa o app publicado pela metade.
if [[ ! -f .env ]]; then
    echo ">> .env AUSENTE em \$APP_DIR — código publicado, artisan pulado."
    echo ">> Crie o .env, rode 'php artisan key:generate' e faça um push vazio:"
    echo ">>   git commit --allow-empty -m redeploy && git push prod \${BRANCH}"
    exit 0
fi

chmod -R ug+rw storage bootstrap/cache

php artisan down --render="errors::503" --retry=15 || true

if [[ "\$RODAR_MIGRATE" == "1" ]]; then
    php artisan migrate --force
fi

# clear ANTES de cachear: cache velho de config sobrevive ao deploy e é a causa
# clássica do "mudei o .env e não pegou".
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan event:cache || true

php artisan up

# ARMADILHA Nº 5: o hook roda como '${USUARIO}', não como root — 'systemctl
# reload' aqui falha calado sem o sudo. E com opcache.validate_timestamps=0,
# não recarregar o FPM significa servir o código ANTIGO indefinidamente.
sudo -n systemctl reload "\$PHP_FPM"
sudo -n systemctl reload nginx

# Worker de fila (se houver) pega o código novo só depois disto.
php artisan queue:restart || true

echo "===== \$(date '+%F %T') deploy concluído ====="
HOOK

chmod +x "${REPO}/hooks/post-receive"
chown -R "${USUARIO}:${USUARIO}" "$REPO" /var/log/deploy
ok "hook de deploy instalado (branch: ${BRANCH})"

# ---------------------------------------------------------------- 14. vhost

etapa "vhost do nginx"

SERVER_NAME="${DOMINIO:-_}"
cat > "/etc/nginx/sites-available/${APP}" <<VHOST
# Gerado por provision-ubuntu.sh
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    root ${ATUAL}/public;
    index index.php;
    charset utf-8;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${PHP_VER}-fpm.sock;
        fastcgi_read_timeout 120;
    }

    # Nada de servir .env, .git e afins.
    location ~ /\.(?!well-known).* { deny all; }

    error_log  /var/log/nginx/${APP}-error.log;
    access_log /var/log/nginx/${APP}-access.log;
}
VHOST

ln -sfn "/etc/nginx/sites-available/${APP}" "/etc/nginx/sites-enabled/${APP}"
rm -f /etc/nginx/sites-enabled/default

if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    ok "vhost ativo em ${SERVER_NAME} → ${ATUAL}/public"
else
    aviso "vhost reprovado no 'nginx -t' — não recarreguei. Rode 'nginx -t'"
fi

[[ -z "$DOMINIO" ]] && aviso "sem --dominio o vhost usa server_name '_' (pega qualquer host). Defina o domínio antes de expor à internet."

# ------------------------------------------------------------------- 15. cron

etapa "Cron do scheduler"

# Log de verdade em vez de >/dev/null: o scheduler é onde falha silenciosa mora,
# e sem log você descobre que ele parou pelo cliente reclamando.
LINHA="* * * * * cd ${ATUAL} && /usr/bin/php${PHP_VER} artisan schedule:run >> /var/log/deploy/${APP}-schedule.log 2>&1"
CRON_ATUAL="$(crontab -u "$USUARIO" -l 2>/dev/null || true)"
if grep -Fq "cd ${ATUAL} && " <<< "$CRON_ATUAL"; then
    ok "crontab já tem a entrada do scheduler"
else
    printf '%s\n%s\n' "$CRON_ATUAL" "$LINHA" | sed '/^$/d' | crontab -u "$USUARIO" -
    ok "crontab do ${USUARIO} configurado"
fi

install -m 0644 -o "$USUARIO" -g "$USUARIO" /dev/null "/var/log/deploy/${APP}-schedule.log"

cat > "/etc/logrotate.d/${APP}" <<EOF
/var/log/deploy/${APP}*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
    su ${USUARIO} ${USUARIO}
}
EOF
ok "logrotate semanal dos logs de deploy e schedule"

# -------------------------------------------------------------------- 16. SSL

if [[ "$RODAR_SSL" == "sim" ]]; then
    etapa "SSL (Let's Encrypt)"
    if [[ -z "$DOMINIO" ]]; then
        aviso "--ssl exige --dominio; certbot não foi executado"
    else
        # Só funciona com o DNS do domínio JÁ apontando para este servidor: o
        # desafio HTTP-01 é a Let's Encrypt batendo de volta na porta 80.
        if certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos \
                   --register-unsafely-without-email --redirect; then
            ok "certificado emitido e renovação automática ativa (certbot.timer)"
        else
            aviso "certbot falhou — quase sempre é DNS ainda não apontando para este IP. Rode depois: certbot --nginx -d ${DOMINIO}"
        fi
    fi
fi

fi   # fim da camada Laravel

# ------------------------------------------------------------------- resumo

etapa "Pronto"

printf '    %-22s %s\n' \
    "usuário"   "${USUARIO} (sudo sem senha)" \
    "SSH"       "porta ${PORTA_SSH} · $(resumo_ssh)" \
    "node"      "$(node -v 2>/dev/null || echo '-') / npm $(npm -v 2>/dev/null || echo '-')" \
    "python"    "$(python3 --version 2>/dev/null || echo '-')" \
    "ufw"       "$(ufw status | head -1)" \
    "fail2ban"  "$(systemctl is-active fail2ban)" \
    "nginx"     "$(systemctl is-active nginx) (user ${USUARIO})" \
    "redis"     "$(systemctl is-active redis-server) (só localhost)"

if [[ "$INSTALAR_MYSQL" == "sim" ]]; then
    printf '    %-22s %s\n' \
        "mysql"     "$(systemctl is-active mysql) (só localhost)"
    [[ -n "$BANCO" ]] && printf '    %-22s %s\n' \
        "banco"     "${BANCO} · usuário ${BANCO} · senha em /root/mysql-${BANCO}.txt"
fi

if [[ -n "$API" ]]; then
    printf '    %-22s %s\n' \
        "api"       "$(systemctl is-active "${API}") · 127.0.0.1:${API_PORTA} · ${API_DOMINIO:-sem domínio}" \
        "api deploy" "$([[ "$API_MODO" == "git" ]] && echo "git pull de ${API_GIT}" || echo "push para ${API_REPO}") (branch ${API_BRANCH})"
fi

if [[ -n "$APP" ]]; then
    printf '    %-22s %s\n' \
        "php"       "$(php -v 2>/dev/null | head -1) · fpm $(systemctl is-active "php${PHP_VER}-fpm")" \
        "app"       "${ATUAL}" \
        "repo"      "${REPO} (branch ${BRANCH})"
fi

if [[ ${#AVISOS[@]} -gt 0 ]]; then
    printf '\n%s%d aviso(s):%s\n' "$AMARELO" "${#AVISOS[@]}" "$NEUTRO"
    for a in "${AVISOS[@]}"; do printf '  - %s\n' "$a"; done
fi

IP="$(hostname -I | awk '{print $1}')"

# Só faz sentido com a base: é ela que mexe no SSH. Com --pular-base a
# configuração de login não foi tocada, e repetir o aviso aqui treinaria você a
# ignorá-lo — inclusive na vez em que ele importa.
if [[ "$PULAR_BASE" != "sim" ]]; then
cat <<EOF

ANTES DE FECHAR ESTA SESSÃO, teste o login novo em OUTRO terminal:

    ssh ${USUARIO}@${IP}

Se não entrar, você ainda está logado aqui e dá para consertar. Fechando antes
de testar, um erro de chave vira chamado de suporte no provedor.
EOF
fi

if [[ -n "$API" ]]; then
cat <<EOF

DEPLOY DA API — modo: ${API_MODO}
$(if [[ "$API_MODO" == "git" ]]; then cat <<GIT
A VPS puxa do repositório. Depois de dar push no GitHub, publique com:

    sudo -u ${USUARIO} ${API_PUBLICAR}

$(if [[ -f "${CHAVE_DEPLOY:-/dev/null}.pub" ]]; then cat <<CHAVE
Se ainda não cadastrou a chave de deploy, ela é esta — vai em
Settings > Deploy keys do repositório (não precisa de write access):

$(sed 's/^/    /' "${CHAVE_DEPLOY}.pub")
CHAVE
fi)
GIT
else cat <<BARE
Na sua máquina, dentro do repositório do backend:

    git remote add vps ${USUARIO}@${IP}:${API_REPO}
    git push vps ${API_BRANCH}

O push publica sozinho — o hook cuida do build, da migration e do restart.
BARE
fi)

O .env já está pronto em ${API_ENV}$([[ -n "$BANCO" ]] && echo ' (com as credenciais do MySQL já preenchidas)').
Só falta acrescentar o domínio da Vercel em ORIGENS_PERMITIDAS depois que o
front subir, e reiniciar:

    sudo nano ${API_ENV}
    sudo systemctl restart ${API}

Conferir: curl http://127.0.0.1:${API_PORTA}/api/saude
Log do deploy: /var/log/deploy/${API}.log
Log do serviço: sudo journalctl -u ${API} -f

O PRIMEIRO usuário que se cadastrar vira admin. Cadastre-se antes de dar o
endereço para qualquer outra pessoa.
EOF
fi

if [[ -n "$APP" ]]; then
cat <<EOF

DEPLOY — na sua máquina:

    git remote add prod ${USUARIO}@${IP}:${REPO}
    git push prod ${BRANCH}

O primeiro push publica o código e PARA antes do artisan (não há .env ainda).
Então, no servidor:

    cd ${ATUAL}
    cp .env.example .env && nano .env      # DB do RDS, REDIS_HOST=127.0.0.1
    php artisan key:generate
    php artisan storage:link

E dispare o deploy completo com um push vazio:

    git commit --allow-empty -m redeploy && git push prod ${BRANCH}

Log do deploy: /var/log/deploy/${APP}.log
Log do schedule: /var/log/deploy/${APP}-schedule.log
EOF
fi
