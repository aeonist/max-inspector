#!/usr/bin/env python3
# MAX Inspector one-command deployer
import os
import socket
import subprocess
import time
import paramiko

SERVER_IP = "46.29.114.201"
PASSWORD = "***REMOVED***"  # secret removed from history; use SSH keys
REMOTE_DIR = "/opt/max-inspector"
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

# Auto-detect local IP for routing
def get_local_ip():
    try:
        out = subprocess.check_output(["hostname", "-I"]).decode().split()
        for ip in out:
            if ip.startswith("10."):
                return ip
        return out[0]
    except Exception:
        return None

local_ip = get_local_ip()
print(f"Connecting to {SERVER_IP}...")

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
if local_ip:
    sock.bind((local_ip, 0))
sock.connect((SERVER_IP, 22))

transport = paramiko.Transport(sock)
transport.connect(username="root", password=PASSWORD)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client._transport = transport

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
        if ".max_env" in root or "__pycache__" in root or ".git" in root or "uploads" in root:
            continue
        rel_path = os.path.relpath(root, local_path)
        dest_dir = os.path.join(remote_path, rel_path).replace("\\", "/")
        try:
            sftp.mkdir(dest_dir)
        except Exception:
            pass
        for file in files:
            if file.endswith(".pyc") or file == "inspector.db" or file == ".env":
                continue
            src_file = os.path.join(root, file)
            dest_file = os.path.join(dest_dir, file).replace("\\", "/")
            sftp.put(src_file, dest_file)

upload_dir(os.path.join(LOCAL_DIR, "backend"), os.path.join(REMOTE_DIR, "backend"))
upload_dir(os.path.join(LOCAL_DIR, "frontend"), os.path.join(REMOTE_DIR, "frontend"))
sftp.close()
print("Files synchronized successfully.")

# 2. Restart service
run_cmd("systemctl restart max-inspector")
time.sleep(2)
run_cmd("systemctl status max-inspector --no-pager")

client.close()
print("\nDeployment completed! Changes are now live on https://46.29.114.201.sslip.io")
