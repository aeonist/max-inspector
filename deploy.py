#!/usr/bin/env python3
# MAX Inspector one-command deployer (SSH key auth, no passwords in code)
#
# Settings are read from the environment or from .env in the project root:
#   DEPLOY_HOST     server address (required)
#   DEPLOY_USER     ssh user (default: root)
#   DEPLOY_DIR      remote project dir (default: /opt/max-inspector)
#   DEPLOY_SERVICE  systemd service name (default: max-inspector)
#   DEPLOY_BIND_IP  optional local IP to connect from (to bypass a VPN route)
# Auth uses your SSH key (~/.ssh/id_ed25519 or ssh-agent). Set it up once:
#   ssh-copy-id root@<DEPLOY_HOST>
import logging
import os
import socket
import sys
import time

import paramiko

LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

# Paramiko prints raw tracebacks from its transport thread; we report errors ourselves
logging.getLogger("paramiko").setLevel(logging.CRITICAL)

# Never upload secrets, local data or caches
SKIP_DIRS = {".max_env", ".git", "__pycache__", "uploads", "node_modules"}
SKIP_FILES = {"inspector.db", ".env"}


# Read KEY=VALUE pairs from .env without overriding real environment variables
def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(os.path.join(LOCAL_DIR, ".env"))

HOST = os.getenv("DEPLOY_HOST")
USER = os.getenv("DEPLOY_USER", "root")
REMOTE_DIR = os.getenv("DEPLOY_DIR", "/opt/max-inspector")
SERVICE = os.getenv("DEPLOY_SERVICE", "max-inspector")
BIND_IP = os.getenv("DEPLOY_BIND_IP")

if not HOST:
    sys.exit("DEPLOY_HOST не задан. Добавьте в .env строку: DEPLOY_HOST=<ip сервера>")

print(f"Connecting to {USER}@{HOST}...")
sock = None
if BIND_IP:
    sock = socket.create_connection((HOST, 22), timeout=15, source_address=(BIND_IP, 0))

client = paramiko.SSHClient()
# Server must already be in ~/.ssh/known_hosts (it is after the first ssh/ssh-copy-id)
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
    client.connect(
        HOST, username=USER, sock=sock, timeout=15, banner_timeout=15,
        allow_agent=True, look_for_keys=True,
    )
except paramiko.AuthenticationException:
    sys.exit(f"Вход по ключу не прошёл. Выполните один раз: ssh-copy-id {USER}@{HOST}")
except (paramiko.SSHException, socket.timeout, TimeoutError, OSError) as e:
    sys.exit(f"Сервер не отвечает ({e}). Если включён VPN — выключите его и повторите.")


def run_cmd(cmd):
    print(f">> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    code = stdout.channel.recv_exit_status()
    if out:
        print(out)
    if err:
        print("[STDERR] " + err)
    if code != 0:
        raise RuntimeError(f"Command failed (code {code}): {cmd}")
    return out


# 1. Upload files via SFTP
sftp = client.open_sftp()
print("Uploading updated files...")


def upload_dir(local_path, remote_path):
    for root, dirs, files in os.walk(local_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel_path = os.path.relpath(root, local_path)
        dest_dir = os.path.normpath(os.path.join(remote_path, rel_path)).replace("\\", "/")
        try:
            sftp.mkdir(dest_dir)
        except OSError:
            pass
        for file in files:
            if file.endswith(".pyc") or file in SKIP_FILES:
                continue
            sftp.put(os.path.join(root, file), f"{dest_dir}/{file}")


upload_dir(os.path.join(LOCAL_DIR, "backend"), f"{REMOTE_DIR}/backend")
upload_dir(os.path.join(LOCAL_DIR, "frontend"), f"{REMOTE_DIR}/frontend")
sftp.close()
print("Files synchronized successfully.")

# 2. Restart service
run_cmd(f"systemctl restart {SERVICE}")
time.sleep(2)
run_cmd(f"systemctl status {SERVICE} --no-pager")

client.close()
print(f"\nDeployment completed! Changes are now live on https://{HOST}.sslip.io")
