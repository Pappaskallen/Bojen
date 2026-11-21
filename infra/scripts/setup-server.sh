#!/bin/sh
# First setup of Bojen's server (byggplan step 9), on a fresh Ubuntu 24.04, as root:
#   sh setup-server.sh <ssh public key of the deploy user>
# Installs Docker from Docker's own apt repository, closes everything but ssh, web and
# LiveKit's ports, turns on automatic security updates and the nightly backup.
set -eu
DEPLOY_KEY="${1:?the deploy user's ssh public key}"
REPO=https://github.com/Pappaskallen/Bojen.git

apt-get update
apt-get install -y ca-certificates curl git ufw unattended-upgrades
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
dpkg-reconfigure -f noninteractive unattended-upgrades

# ssh with keys only.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# The firewall. Docker publishes 80 and 443 itself; LiveKit and SIP use host networking.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443
ufw allow 7881/tcp comment "LiveKit RTC over TCP"
ufw allow 3478/udp comment "LiveKit TURN"
ufw allow 50000:60000/udp comment "LiveKit media"
ufw allow 5060 comment "SIP from 46elks"
ufw allow 10000:20000/udp comment "SIP media"
ufw --force enable

# The deploy user, who runs everything from /srv/bojen.
id bojen >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker bojen
install -d -m 700 -o bojen -g bojen /home/bojen/.ssh
echo "$DEPLOY_KEY" > /home/bojen/.ssh/authorized_keys
chown bojen:bojen /home/bojen/.ssh/authorized_keys
chmod 600 /home/bojen/.ssh/authorized_keys
[ -d /srv/bojen ] || git clone "$REPO" /srv/bojen
chown -R bojen:bojen /srv/bojen

# The nightly backup at 01:30 UTC, before the privacy clean-up in the worker at 02:00.
cat > /etc/systemd/system/bojen-backup.service <<'UNIT'
[Unit]
Description=Bojen: full backup of Postgres with WAL-G
[Service]
Type=oneshot
User=bojen
ExecStart=/bin/sh /srv/bojen/infra/scripts/backup.sh
UNIT
cat > /etc/systemd/system/bojen-backup.timer <<'UNIT'
[Unit]
Description=Bojen: nightly backup
[Timer]
OnCalendar=*-*-* 01:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now bojen-backup.timer

echo "Klart. Lägg infra/.env i /srv/bojen/infra/ (se infra/README.md) och kör deploy.sh som bojen."
