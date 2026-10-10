#!/usr/bin/env bash
# MAX Inspector: set up a clean Ubuntu 22.04/24.04 server with one command.
#
#   curl -fsSL https://raw.githubusercontent.com/aeonist/max-inspector/main/deploy/server-setup.sh | sudo bash
#
# What it does (safe to run again, it then updates the app and keeps .env and data):
#   - firewall: only SSH, 80 and 443 are open; fail2ban against SSH password guessing
#   - asks for your public SSH key once and then turns password login off
#   - installs Docker, clones the repo to /opt/max-inspector
#   - asks for BOT_TOKEN once, sets WEBAPP_URL=https://<public IP>.sslip.io
#   - starts the app behind Caddy (automatic HTTPS certificate)
#   - prints the mini-app address to bind to the bot
#
# Options:
#   --lock-ssh   allow SSH login by key only (run after `ssh-copy-id root@<IP>`)
# Optional environment: BOT_TOKEN, DOMAIN (own domain instead of sslip.io),
#   MINIAPP_MODE (openapp|link, default openapp), BRANCH (default main)
set -euo pipefail

REPO_URL="https://github.com/aeonist/max-inspector.git"
APP_DIR="/opt/max-inspector"
BRANCH="${BRANCH:-main}"
COMPOSE=(docker compose -f compose.yaml -f deploy/compose.server.yaml)

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

LOCK_SSH=0
for arg in "$@"; do
  case "$arg" in
    --lock-ssh) LOCK_SSH=1 ;;
    *) die "неизвестный параметр $arg" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "запустите от root: ... | sudo bash"

SSH_LOCK_CONF=/etc/ssh/sshd_config.d/00-max-inspector.conf

# authorized_keys of the user who ran sudo (root when logged in as root)
keys_file() {
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    echo "$(getent passwd "$SUDO_USER" | cut -d: -f6)/.ssh/authorized_keys"
  else
    echo /root/.ssh/authorized_keys
  fi
}

# SSH key-only login. Refuses to run without a key, so the server can't be locked out.
lock_ssh() {
  local keys
  keys="$(keys_file)"
  if ! grep -qE '^(ssh-|ecdsa-|sk-)' "$keys" 2>/dev/null; then
    die "в $keys нет ни одного ключа. Сначала на своём компьютере выполните: ssh-copy-id root@<IP сервера>"
  fi
  cat > "$SSH_LOCK_CONF" <<'EOF'
# Key-only SSH login (deploy/server-setup.sh --lock-ssh)
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t || { rm -f "$SSH_LOCK_CONF"; die "конфигурация SSH не прошла проверку, ничего не изменено"; }
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  say "Вход по паролю выключен, теперь только по ключу."
}

if [ "$LOCK_SSH" -eq 1 ]; then
  lock_ssh
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

say "Ставлю системные пакеты"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades >/dev/null
# Security updates install themselves every day
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

# Password login over SSH is how small servers get hacked: switch to a key right away
if [ ! -f "$SSH_LOCK_CONF" ]; then
  echo
  echo "Вставьте публичный SSH-ключ со своего компьютера (строка ssh-ed25519 AAAA...)"
  printf 'и нажмите Enter. Просто Enter: оставить вход по паролю: '
  read -r PUBKEY < /dev/tty || PUBKEY=""
  if [ -n "$PUBKEY" ]; then
    printf '%s\n' "$PUBKEY" | ssh-keygen -l -f - >/dev/null 2>&1 || die "это не похоже на публичный SSH-ключ, ничего не изменено"
    KEYS="$(keys_file)"
    mkdir -p "$(dirname "$KEYS")" && chmod 700 "$(dirname "$KEYS")"
    grep -qxF "$PUBKEY" "$KEYS" 2>/dev/null || printf '%s\n' "$PUBKEY" >> "$KEYS"
    chmod 600 "$KEYS"
    [ -z "${SUDO_USER:-}" ] || chown -R "$SUDO_USER:" "$(dirname "$KEYS")"
    lock_ssh
  else
    warn "Вход по паролю оставлен. Это небезопасно: лучше перезапустить скрипт и вставить ключ."
  fi
fi

# Small VPS (1 GB) can run out of memory while building the image
if [ "$(swapon --noheadings | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  say "Добавляю swap 1 ГБ"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Настраиваю файрвол: открыты только SSH, 80 и 443"
# Keep every port sshd listens on open, so the current session is never cut off
ufw allow 22/tcp >/dev/null
for port in $(ss -Htlnp 2>/dev/null | awk '/sshd/ {n=split($4, a, ":"); print a[n]}' | sort -u); do
  ufw allow "$port/tcp" >/dev/null
done
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null 2>&1 || true

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Ставлю Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null

say "Скачиваю приложение в $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# Read a value from an existing .env
env_get() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n1 || true; }

if [ -f .env ]; then
  say "Файл .env уже есть, оставляю его как есть"
  DOMAIN="$(env_get DOMAIN)"
  [ -n "$DOMAIN" ] || die "в $APP_DIR/.env нет строки DOMAIN=..., удалите .env и запустите скрипт снова"
else
  PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)"
  [[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "не удалось узнать внешний IP сервера"
  DOMAIN="${DOMAIN:-$PUBLIC_IP.sslip.io}"

  if [ -z "${BOT_TOKEN:-}" ]; then
    printf '\nВставьте BOT_TOKEN бота MAX и нажмите Enter (символы не отображаются): '
    read -r -s BOT_TOKEN < /dev/tty
    echo
  fi
  [ -n "$BOT_TOKEN" ] || warn "BOT_TOKEN пустой: сайт поднимется, но бот работать не будет. Токен можно дописать в $APP_DIR/.env и запустить скрипт снова."

  umask 077
  cat > .env <<EOF
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=
WEBAPP_URL=https://$DOMAIN
MINIAPP_MODE=${MINIAPP_MODE:-openapp}
DOMAIN=$DOMAIN
EOF
  umask 022
fi

say "Собираю и запускаю приложение (первый раз до нескольких минут)"
"${COMPOSE[@]}" up -d --build --remove-orphans

say "Жду, пока приложение ответит"
APP_ID="$("${COMPOSE[@]}" ps -q app)"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_ID" 2>/dev/null)" = healthy ] && break
  sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_ID")" = healthy ] \
  || die "приложение не запустилось. Логи: cd $APP_DIR && docker compose logs app"

say "Жду HTTPS-сертификат для $DOMAIN"
HTTPS_OK=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then HTTPS_OK=1; break; fi
  sleep 3
done

echo
if [ "$HTTPS_OK" -eq 1 ]; then
  say "Готово. Приложение работает по HTTPS."
else
  warn "Приложение запущено, но HTTPS пока не отвечает. Обычно сертификат появляется в течение пары минут."
  warn "Если не появится, посмотрите логи: cd $APP_DIR && docker compose -f compose.yaml -f deploy/compose.server.yaml logs caddy"
fi
cat <<EOF

  Адрес мини-приложения для привязки к боту:  https://$DOMAIN
  Проверка:                                  https://$DOMAIN/api/health

  Режим кнопок бота: $(env_get MINIAPP_MODE). Пока новый адрес не привязан к боту,
  кнопки openapp открывают старый адрес. Временно включить вход по ссылке:
    sed -i 's/^MINIAPP_MODE=.*/MINIAPP_MODE=link/' $APP_DIR/.env && cd $APP_DIR && ${COMPOSE[*]} up -d

  Обновить приложение до свежего кода: запустите эту же команду установки ещё раз.
EOF
if [ -f "$SSH_LOCK_CONF" ]; then
  echo "  Вход на сервер: только по SSH-ключу."
else
  warn "  Вход на сервер по паролю всё ещё включён. Запустите команду установки ещё раз и вставьте SSH-ключ."
fi
