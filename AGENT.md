# AGENT.md — PgMaker VM-Control Sidecar Systemd Migration

## Goal

Update the **vm-control sidecar project** so the PostgreSQL lifecycle scripts and systemd unit files live in the **sidecar package**, not only in the Firecracker VM image/bootstrap.

The VM image should keep only the minimum needed to start `vm-control`. The sidecar should be able to install or override the PgVM PostgreSQL scripts and systemd unit files at runtime, so future fixes can be delivered by upgrading the sidecar package from Nexus instead of rebuilding the VM image.

---

## Existing components

The VM image/bootstrap currently owns these base files:

```text
/etc/systemd/system/vm-control.service
/usr/local/bin/vm-control-run
/etc/vm-control/env
```

`vm-control-manager` downloads/upgrades the sidecar package from Nexus.

`vm-control-run` runs the currently deployed sidecar package.

Historically, `supervisor.js` started PostgreSQL as a child process and reported DB health through a local socket. The new design should remove PostgreSQL ownership from `supervisor.js` and run PostgreSQL through systemd.

---

## Important ownership rule

Keep this in the **VM image/bootstrap**:

```text
vm-control.service
vm-control-run
vm-control-manager
minimum env/profile wiring needed to start vm-control
```

Move this into the **sidecar package**:

```text
pgvm scripts
pgvm systemd units
pgvm install/update logic
pgvm state helper
```

The sidecar cannot create `vm-control.service` before the sidecar itself is running. So the base VM image still needs to start `vm-control`.

---

## Target sidecar package layout

Add this under the sidecar release:

```text
<sidecar-release>/
  pgvm/
    install.sh
    pgvm-postgres-common.sh
    pgvm-postgres-launch
    pgvm-postgres-stop
    pgvm-postgres-stop-post
    pgvm-postgres-reload
    pgvm-postgres-op
    pgvm-postgres-op-status
    pgvm-postgres-state

  systemd/
    pgvm-postgres.service
    pgvm-postgres-op@.service
    pgvm-control.slice            # optional/recommended
```

The sidecar should deploy these files into the VM when it starts or when it is upgraded.

---

## Golden install condition

Only install PgVM systemd integration if the VM has `vm-control.service`.

Check with:

```bash
systemctl cat vm-control.service >/dev/null 2>&1
```

or:

```bash
test -f /etc/systemd/system/vm-control.service
```

If `vm-control.service` does not exist, skip installation and continue without mutating the VM.

Reason: the PgVM integration is only intended for PgMaker VM-control VMs.

---

## Required boot scenarios

### Scenario 1: fresh VM boot

Flow:

```text
1. systemd starts vm-control.service
2. vm-control-run starts the sidecar package
3. sidecar startup calls ensurePgvmSystemdInstalled()
4. installer detects vm-control.service
5. installer deploys pgvm scripts and systemd units
6. installer runs systemctl daemon-reload
7. sidecar starts API/WebSocket
8. later, orchestration provides DB/version/data dir
9. sidecar writes /run/pgvm/cluster.env
10. sidecar starts pgvm-postgres.service
```

Do not auto-start Postgres just because the sidecar booted. DB name and PG version are decided later.

### Scenario 2: sidecar upgrade while DB is already running

If `pgvm-postgres.service` is active/activating/deactivating, do **not** restart Postgres and do **not** surprise-change the running unit behavior.

Allowed during upgrade:

```text
- update /usr/local/bin/pgvm-postgres-* helper scripts atomically
- update sidecar internal files
- write pending unit files to /data/local/pgvm/pending-systemd
- log that systemd unit update is pending until DB is stopped/rebooted
```

Avoid during upgrade while DB is active:

```text
- do not stop Postgres
- do not restart Postgres
- do not overwrite active unit definitions if that requires daemon-reload
- do not force daemon-reload for unit changes unless explicitly safe
```

If `pgvm-postgres.service` is inactive/failed, it is safe to update unit files and run `systemctl daemon-reload`.

---

## Legacy and systemd dual support

The sidecar must support both modes during migration.

### Legacy mode

Use the existing direct command/supervisor flow.

Use legacy mode when:

```text
- systemd integration is disabled
- pgvm install fails and mode is auto
- vm-control.service is missing
- pgvm-postgres.service is unavailable
- caller explicitly requests legacy mode
```

### Systemd mode

Use systemd-managed PostgreSQL.

Use systemd mode when:

```text
- vm-control.service exists
- pgvm systemd install succeeds
- pgvm-postgres.service is present
- PGVM_SYSTEMD_MODE is auto or required
```

Recommended config:

```text
PGVM_SYSTEMD_MODE=auto      # auto | required | disabled
```

Behavior:

```text
auto      -> use systemd if installed, otherwise fallback to legacy
required  -> fail startup or request if systemd install/use fails
disabled  -> skip systemd flow and keep legacy behavior
```

Implement this behind one adapter layer:

```text
dbLifecycle.start()
dbLifecycle.stop()
dbLifecycle.restart()
dbLifecycle.reload()
dbLifecycle.init()
dbLifecycle.basebackup()
dbLifecycle.rewind()
dbLifecycle.promote()
dbLifecycle.checkpoint()
dbLifecycle.state()
```

Do not scatter `if systemd` checks across the project.

---

## Runtime files

Systemd flow is controlled by runtime files under `/run/pgvm`.

### `/run/pgvm/cluster.env`

Written before starting PostgreSQL.

Example:

```bash
PGMAJOR=16
PG_HOME=/opt/eFX/apps/evolve/postgres/16/usr/pgsql-16
PG_BIN_DIR=/opt/eFX/apps/evolve/postgres/16/usr/pgsql-16/bin
PGDATA=/data/local/evolve_access_centre_db_localhost
PGPORT=5432
PGCLUSTER_NAME=evolve_access_centre_db_localhost
PGOPTS=
```

Postgres version can be 14, 15, 16, 17, or 18. Do not hardcode version in the unit file.

### `/run/pgvm/stop.env`

Optional. Written before stop/restart when custom stop behavior is needed.

Defaults if missing:

```bash
PG_STOP_MODE=fast
PG_STOP_TIMEOUT=90
PG_STOP_WAIT=yes
```

Allowed modes:

```text
smart
fast
immediate
```

Example:

```bash
PG_STOP_MODE=fast
PG_STOP_TIMEOUT=300
PG_STOP_WAIT=yes
```

### `/run/pgvm/op.env`

Written before one-shot operations.

Used by:

```bash
systemctl start pgvm-postgres-op@init.service
systemctl start pgvm-postgres-op@basebackup.service
systemctl start pgvm-postgres-op@rewind.service
systemctl start pgvm-postgres-op@promote.service
systemctl start pgvm-postgres-op@checkpoint.service
```

---

## Persistent metadata

Durable cluster metadata should live on persistent disk, not only `/run`.

Recommended:

```text
/data/local/pgvm/cluster.json
```

or:

```text
/data/local/pgvm/cluster.env
```

Store durable identity:

```text
PG major version
PGDATA
port
cluster name
auto-start flag if needed
role/topology hint if needed
```

Do not persist one-shot `op.env` or `stop.env` as durable desired state. Those are transient.

---

## Systemd unit: pgvm-postgres.service

Use this as the target shape:

```ini
[Unit]
Description=PgMaker PostgreSQL Server
After=local-fs.target network-online.target
Wants=network-online.target
ConditionPathExists=/run/pgvm/cluster.env

[Service]
Type=notify
User=appuser
Group=appuser

ExecStart=/usr/local/bin/pgvm-postgres-launch
ExecStop=/usr/local/bin/pgvm-postgres-stop
ExecReload=/usr/local/bin/pgvm-postgres-reload
ExecStopPost=/usr/local/bin/pgvm-postgres-stop-post

Restart=on-failure
RestartSec=5
TimeoutStartSec=infinity
TimeoutStopSec=600

KillMode=mixed
KillSignal=SIGINT

OOMScoreAdjust=300
MemoryHigh=75%
MemoryMax=85%
MemorySwapMax=1G
CPUWeight=100
IOWeight=100
TasksMax=4096

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

PostgreSQL binaries in this environment are compiled with `--with-systemd`, so `Type=notify` is acceptable as long as the launcher ends with `exec postgres ...`.

Do not use `pg_ctl start` in `ExecStart`.

---

## Systemd unit: pgvm-postgres-op@.service

Use one generic op unit. Do not split critical/maintenance units for now.

```ini
[Unit]
Description=PgMaker PostgreSQL operation %i
After=local-fs.target network-online.target
Wants=network-online.target
ConditionPathExists=/run/pgvm/op.env

[Service]
Type=oneshot
User=appuser
Group=appuser

ExecStart=/usr/local/bin/pgvm-postgres-op %i
ExecStopPost=/usr/local/bin/pgvm-postgres-op-status %n

TimeoutStartSec=infinity

OOMScoreAdjust=-500
MemoryMin=128M
MemoryLow=256M
MemoryHigh=85%

CPUWeight=700
IOWeight=700
TasksMax=512

StandardOutput=journal
StandardError=journal
```

Rationale:

```text
- op service should have more priority than Postgres
- promote/checkpoint/rewind may need to run while Postgres is busy
- basebackup/initdb may use available VM resources
- do not hard cap MemoryMax unless future testing proves it is needed
- sidecars should be protected separately using a control slice
```

---

## Optional systemd slice: pgvm-control.slice

Recommended for vm-control and other sidecars.

```ini
[Unit]
Description=PgMaker control-plane and sidecar slice

[Slice]
MemoryMin=768M
MemoryLow=1536M
CPUWeight=1000
IOWeight=1000
```

If used, `vm-control.service` can include:

```ini
[Service]
Slice=pgvm-control.slice
OOMScoreAdjust=-900
MemoryMax=512M
MemorySwapMax=128M
CPUWeight=1000
IOWeight=1000
```

Only apply/override `vm-control.service` if the platform owner agrees. The sidecar may provide an optional drop-in, but must not break base vm-control startup.

---

## Installer requirements

Implement `pgvm/install.sh` as idempotent.

It must:

```text
1. verify vm-control.service exists
2. detect whether pgvm-postgres.service is active
3. install/update helper scripts atomically
4. install/update unit files only when safe
5. run systemctl daemon-reload only when needed and safe
6. never auto-start or auto-restart PostgreSQL
7. log clear actions
8. exit non-zero only on real install failure
```

### Detection

```bash
has_vm_control() {
  systemctl cat vm-control.service >/dev/null 2>&1
}

postgres_is_active() {
  systemctl is-active --quiet pgvm-postgres.service
}
```

### Active DB upgrade behavior

If Postgres is active:

```text
- install /usr/local/bin/pgvm-postgres-* scripts
- do not replace unit files in /etc/systemd/system
- write pending unit files to /data/local/pgvm/pending-systemd
- do not restart DB
```

### Inactive DB behavior

If Postgres is not active:

```text
- install scripts
- install unit files
- run systemctl daemon-reload
- reset failed state if needed
```

---

## Root/sudo model

The sidecar normally runs as `appuser`. Installing under `/usr/local/bin` and `/etc/systemd/system` requires root.

Do not run the whole HTTP sidecar as root.

Preferred approach:

```text
- keep vm-control as appuser
- use a small root-owned wrapper or restricted sudo for installer/systemctl actions
```

Example commands that may need sudo:

```bash
sudo /usr/local/sbin/pgvm-apply-systemd <sidecar-release>/pgvm
sudo systemctl start pgvm-postgres.service
sudo systemctl stop pgvm-postgres.service
sudo systemctl restart pgvm-postgres.service
sudo systemctl reload pgvm-postgres.service
sudo systemctl start pgvm-postgres-op@promote.service
sudo systemctl show pgvm-postgres.service ...
```

Prefer a stable root-owned wrapper over allowing mutable sidecar scripts to run directly as root.

---

## Script behavior requirements

### pgvm-postgres-launch

Must:

```text
- load /run/pgvm/cluster.env
- resolve PG_HOME/PG_BIN_DIR for PG 14-18
- export LD_LIBRARY_PATH
- exec postgres directly
```

Final command must look like:

```bash
exec "$PG_BIN_DIR/postgres" \
  -D "$PGDATA" \
  -p "${PGPORT:-5432}" \
  -c "cluster_name=${PGCLUSTER_NAME:-pgvm}" \
  ${PGOPTS:-}
```

### pgvm-postgres-stop

Must:

```text
- load cluster.env
- optionally load stop.env
- default to fast / 90 seconds / wait yes
- validate mode smart|fast|immediate
- use pg_ctl stop
```

### pgvm-postgres-op

Must:

```text
- read operation from %i
- load /run/pgvm/op.env
- validate required variables per operation
- support init, basebackup, rewind, promote, checkpoint
- use a lock file to prevent overlapping ops
```

Lock example:

```bash
LOCK_FILE=/run/pgvm/postgres-op.lock
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another pgvm operation is running" >&2; exit 1; }
```

### pgvm-postgres-state

Must return JSON when called with `--json`.

It should include raw systemd and pg_isready fields. Do not map states.

Example:

```json
{
  "service": "pgvm-postgres.service",
  "systemd": {
    "LoadState": "loaded",
    "ActiveState": "active",
    "SubState": "running",
    "Result": "success",
    "MainPID": 1234,
    "UnitFileState": "enabled"
  },
  "pgIsReady": {
    "ran": true,
    "exitCode": 0,
    "stdout": "127.0.0.1:5432 - accepting connections",
    "stderr": ""
  },
  "ts": "2026-04-30T00:00:00Z"
}
```

vm-control should relay this JSON as-is.

---

## Node.js sidecar integration

At startup:

```js
await ensurePgvmSystemdInstalled();
```

Behavior:

```text
- if PGVM_SYSTEMD_MODE=disabled, skip install
- if vm-control.service missing, skip install and use legacy
- if install succeeds, systemd mode is available
- if install fails and mode=auto, log and use legacy
- if install fails and mode=required, fail startup/request
```

All DB lifecycle APIs should go through the adapter layer.

Systemd start example:

```js
await writeFile('/run/pgvm/cluster.env', clusterEnvText);
await execFile('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', 'pgvm-postgres.service']);
```

Systemd op example:

```js
await writeFile('/run/pgvm/op.env', opEnvText);
await execFile('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', `pgvm-postgres-op@${op}.service`]);
```

State example:

```js
const state = await execFile('/usr/local/bin/pgvm-postgres-state', ['--json']);
// relay JSON unchanged
```

---

## WebSocket status relay

If WebSocket is enabled on port `3000`, it should relay raw state payloads.

Do not create another state mapping in Node.

Flow:

```text
poll or event trigger -> call pgvm-postgres-state --json -> broadcast JSON unchanged
```

---

## Do not do

Do not:

```text
- reintroduce supervisor.js as Postgres owner in systemd mode
- spawn postgres directly from vm-control in systemd mode
- use pg_ctl start in systemd ExecStart
- hardcode PG version in systemd unit
- install PgVM systemd integration if vm-control.service is absent
- restart a running database during sidecar upgrade
- overwrite active unit files while Postgres is active unless explicitly requested
- duplicate state mappings in vm-control
- persist op.env or stop.env as desired state
```

---

## Test checklist

### Fresh boot

```bash
systemctl status vm-control.service
systemctl cat pgvm-postgres.service
systemctl cat pgvm-postgres-op@.service
```

Expected:

```text
vm-control active
pgvm units installed
Postgres not auto-started unless requested
```

### Start DB

```bash
cat >/run/pgvm/cluster.env <<'CLUSTER_EOF'
PGMAJOR=16
PG_HOME=/opt/eFX/apps/evolve/postgres/16/usr/pgsql-16
PG_BIN_DIR=/opt/eFX/apps/evolve/postgres/16/usr/pgsql-16/bin
PGDATA=/data/local/testdb
PGPORT=5432
PGCLUSTER_NAME=testdb
CLUSTER_EOF

systemctl start pgvm-postgres.service
pgvm-postgres-state --json
```

### Stop DB

```bash
cat >/run/pgvm/stop.env <<'STOP_EOF'
PG_STOP_MODE=fast
PG_STOP_TIMEOUT=300
PG_STOP_WAIT=yes
STOP_EOF

systemctl stop pgvm-postgres.service
```

### Operation

```bash
cat >/run/pgvm/op.env <<'OP_EOF'
# operation-specific values
OP_EOF

systemctl start pgvm-postgres-op@promote.service
```

### Upgrade while DB running

Expected:

```text
helper scripts updated
unit file changes deferred or safely handled
Postgres not restarted
state endpoint still works
legacy fallback still available
```

---

## Final principle

The VM image should provide stable bootstrapping for `vm-control`.

The sidecar release should own evolving PostgreSQL lifecycle tooling.

This gives PgMaker:

```text
- fewer VM image rebuilds
- faster script changes through Nexus sidecar upgrades
- clean migration from legacy supervisor.js to systemd
- safe behavior during fresh boot and sidecar upgrade
- support for PG 14 through PG 18
```
