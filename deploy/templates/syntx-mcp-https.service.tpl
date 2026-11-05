[Unit]
Description=Private owner SYNTX MCP HTTPS upstream
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
User=@@USER@@
Group=@@USER@@
WorkingDirectory=@@RELEASE_QUOTED@@
Environment=@@CONFIG_ENV_QUOTED@@
ExecStart=@@NODE_QUOTED@@ @@ENTRY_QUOTED@@ serve
UMask=0077
StateDirectory=@@USER@@
StateDirectoryMode=0700
ReadWritePaths=@@STATE_QUOTED@@
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=3G
CPUQuota=100%
TasksMax=128
LimitNOFILE=1024
TimeoutStartSec=60
TimeoutStopSec=960
KillMode=mixed
KillSignal=SIGTERM
# Restart never dispatches/replays work; process-local circuit/reference/recovery context is lost.
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
