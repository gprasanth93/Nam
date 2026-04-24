# AGENT.md - PgMaker VM control rules after removing `supervisor.js`

## Purpose

This project manages PostgreSQL inside Firecracker VMs. The old design used `supervisor.js` to spawn PostgreSQL as a child process, watch child exit, and signal health over a socket back to `vm-control`. The new design removes `supervisor.js` entirely and moves PostgreSQL daemon ownership into systemd.

Any future changes to `vm-control` must follow this document.

---

## New architecture

### Control plane

- `vm-control.service` remains the always-on Node.js service.
- `vm-control` is the control-plane API and state broadcaster.
- `vm-control` must no longer spawn PostgreSQL directly.
- `vm-control` must no longer start or manage `supervisor.js`.
- `supervisor.js` must be removed from the runtime path and code path.

### Database daemon

- PostgreSQL runs only as `pgvm-postgres.service`.
- systemd owns the main PostgreSQL process.
- systemd provides the PostgreSQL cgroup boundary.
- all PostgreSQL child processes stay under the PostgreSQL unit cgroup.

### One-shot operations

- `initdb`, `basebackup`, `rewind`, `checkpoint`, and `promote` run through `pgvm-postgres-op@.service`.
- these actions must not run as child processes of `vm-control`.
- these actions must not run inside the `vm-control.service` cgroup.
- `vm-control` must invoke them through `systemctl start pgvm-postgres-op@<operation>.service`.

---

## Required high-level behavior

### Start path

When a VM boots or when a new DB is created:

1. `vm-control` determines whether a cluster already exists.
2. `vm-control` determines PostgreSQL version, data directory, port, and cluster name.
3. `vm-control` writes `/run/pgvm/cluster.env`.
4. `vm-control` calls `systemctl start pgvm-postgres.service`.
5. `vm-control` observes PostgreSQL state via systemd and readiness checks.
6. `vm-control` broadcasts state changes to its existing consumers.

### Stop path

1. `vm-control` optionally writes `/run/pgvm/stop.env`.
2. `vm-control` calls `systemctl stop pgvm-postgres.service`.
3. the service's `ExecStop` wrapper reads the stop env and performs `pg_ctl stop` with the requested mode.
4. if no stop env exists, defaults are used.

### Restart path

1. `vm-control` optionally writes `/run/pgvm/stop.env`.
2. `vm-control` calls `systemctl restart pgvm-postgres.service`.
3. systemd runs `ExecStop`, then `ExecStart` again.

### Reload path

- `vm-control` calls `systemctl reload pgvm-postgres.service`.

### One-shot operation path

1. `vm-control` writes `/run/pgvm/op.env`.
2. `vm-control` calls `systemctl start pgvm-postgres-op@<operation>.service`.
3. `vm-control` reads logs or unit status if needed.
4. `vm-control` removes or overwrites `/run/pgvm/op.env` for the next action.

---

## Runtime file contracts

### `/run/pgvm/cluster.env`

This file is required before any PostgreSQL start.

It must contain enough information to derive the binary path and runtime launch parameters.

Minimum supported keys:

- `PGDATA`
- one of:
  - `PG_BIN_DIR`
  - `PG_HOME`
  - `PGMAJOR`

Optional keys:

- `PGPORT`
- `PGCLUSTER_NAME`
- `PGOPTS`

Example:

```bash
PGMAJOR=18
PG_HOME=/opt/eFX/apps/evolve/postgres/18/usr/pgsql-18
PG_BIN_DIR=/opt/eFX/apps/evolve/postgres/18/usr/pgsql-18/bin
PGDATA=/data/local/evolve_access_centre_db_localhost
PGPORT=5432
PGCLUSTER_NAME=evolve_access_centre_db_localhost
PGOPTS=
```

### `/run/pgvm/stop.env`

Optional stop behavior overrides.

Supported keys:

- `PG_STOP_MODE=smart|fast|immediate`
- `PG_STOP_TIMEOUT=<seconds>`
- `PG_STOP_WAIT=yes|no`

Default behavior when absent:

- `PG_STOP_MODE=fast`
- `PG_STOP_TIMEOUT=90`
- `PG_STOP_WAIT=yes`

### `/run/pgvm/op.env`

Used only for one-shot operations.

This file is transient and operation-specific.

`vm-control` must write only the variables needed for the chosen operation.

---

## Persistent versus runtime state

### Persist on mounted disk

Persist durable cluster identity on the mounted persistent volume.

Recommended durable fields:

- postgres major version
- PGDATA
- port
- cluster name
- auto-start flag
- any role hint you track

Recommended durable path:

- `/data/local/pgvm/cluster.json`

`vm-control` should read durable state at boot and derive `/run/pgvm/cluster.env` from it.

### Do not persist

Do not persist `/run/pgvm/stop.env` or `/run/pgvm/op.env`.

These are one-shot control inputs and must not survive reboot.

---

## Health and readiness model

### `vm-control` replaces the old supervisor socket

The old supervisor emitted child process state over a socket.

The new model is:

- systemd owns PostgreSQL lifecycle state
- `vm-control` owns health evaluation and broadcasting

### Source of truth for lifecycle

`vm-control` must use systemd as the source of truth for process lifecycle.

Recommended command:

```bash
systemctl show pgvm-postgres.service -p ActiveState -p SubState -p Result -p MainPID
```

### Source of truth for readiness

`vm-control` should use `/usr/local/bin/pgvm-postgres-state` or directly use `pg_isready`.

Recommended semantics:

- `active` + `pg_isready=0` -> `ready`
- `active` + `pg_isready=1` -> `running_but_rejecting`
- `failed` or `inactive` -> `down`
- `activating` -> `starting`

### Event broadcasting

`vm-control` should continue broadcasting DB up/down/unhealthy transitions to its current consumers.

The difference is that events now come from:

- systemd unit state changes
- readiness probes

and not from a custom supervisor child-process socket.

A first implementation may poll every 1 to 2 seconds. A later implementation may subscribe to systemd D-Bus events.

---

## Resource ownership and cgroups

### Required cgroup boundaries

- `vm-control.service` must contain `vm-control` and only its own helper children.
- `pgvm-postgres.service` must contain PostgreSQL only.
- `pgvm-postgres-op@.service` must contain one-shot DB operations only.

### Forbidden behavior

- do not spawn PostgreSQL from `vm-control` with `child_process.spawn()`.
- do not spawn `pg_basebackup`, `pg_rewind`, or `initdb` as direct children of `vm-control`.
- do not keep any replacement babysitter process that simply wraps PostgreSQL.

### Why

Spawning PostgreSQL directly from `vm-control` would place PostgreSQL in the `vm-control` cgroup, which defeats isolation.

---

## Required code changes in `vm-control`

### Remove

- remove any code that starts `supervisor.js`
- remove any code that kills `supervisor.js`
- remove any code that expects a supervisor socket path
- remove any logic that treats PostgreSQL as a direct child process
- remove any cleanup logic specific to supervisor PID files or sockets

### Replace with systemd-driven commands

For start:

- write `/run/pgvm/cluster.env`
- call `systemctl start pgvm-postgres.service`

For stop:

- optionally write `/run/pgvm/stop.env`
- call `systemctl stop pgvm-postgres.service`

For restart:

- optionally write `/run/pgvm/stop.env`
- call `systemctl restart pgvm-postgres.service`

For reload:

- call `systemctl reload pgvm-postgres.service`

For operations:

- write `/run/pgvm/op.env`
- call `systemctl start pgvm-postgres-op@<operation>.service`

### State API changes

Expose PostgreSQL state using systemd + readiness data.

Recommended internal shape:

```json
{
  "unit": "pgvm-postgres.service",
  "activeState": "active",
  "subState": "running",
  "result": "success",
  "mainPid": "1234",
  "ready": "accepting",
  "healthy": true
}
```

Use `/usr/local/bin/pgvm-postgres-state` if convenient.

---

## Supported one-shot operations and env mapping

### `init`

Supported env keys:

- `PG_INIT_PGMAJOR` or `PG_INIT_PG_HOME` or `PG_INIT_BIN_DIR`
- `PG_INIT_PGDATA`
- `PG_INIT_USERNAME`
- `PG_INIT_PWFILE`
- `PG_INIT_AUTH`
- `PG_INIT_AUTH_HOST`
- `PG_INIT_AUTH_LOCAL`
- `PG_INIT_ENCODING`
- `PG_INIT_LOCALE`
- `PG_INIT_LC_COLLATE`
- `PG_INIT_LC_CTYPE`
- `PG_INIT_LOCALE_PROVIDER`
- `PG_INIT_ICU_LOCALE`
- `PG_INIT_WALDIR`
- `PG_INIT_WAL_SEGSIZE`
- `PG_INIT_ALLOW_GROUP_ACCESS`
- `PG_INIT_DATA_CHECKSUMS`

### `basebackup`

Supported env keys:

- `PG_BB_PGMAJOR` or `PG_BB_PG_HOME` or `PG_BB_BIN_DIR`
- `PG_BB_SOURCE_CONNSTR`
- `PG_BB_TARGET_DIR`
- `PG_BB_FORMAT`
- `PG_BB_WAL_METHOD`
- `PG_BB_SLOT`
- `PG_BB_CREATE_SLOT`
- `PG_BB_MAX_RATE`
- `PG_BB_LABEL`
- `PG_BB_COMPRESS`
- `PG_BB_INCREMENTAL_MANIFEST`
- `PG_BB_WRITE_RECOVERY_CONF`
- `PG_BB_PROGRESS`
- `PG_BB_NO_SYNC`

### `rewind`

Supported env keys:

- `PG_RW_PGMAJOR` or `PG_RW_PG_HOME` or `PG_RW_BIN_DIR`
- `PG_RW_TARGET_PGDATA`
- one of `PG_RW_SOURCE_PGDATA` or `PG_RW_SOURCE_CONNSTR`
- `PG_RW_WRITE_RECOVERY_CONF`
- `PG_RW_RESTORE_TARGET_WAL`
- `PG_RW_DRY_RUN`
- `PG_RW_PROGRESS`
- `PG_RW_NO_SYNC`
- `PG_RW_NO_ENSURE_SHUTDOWN`
- `PG_RW_CONFIG_FILE`

### `checkpoint`

Supported env keys:

- `PG_CP_CONNSTR`

### `promote`

Supported env keys:

- `PG_PROMOTE_WAIT`
- `PG_PROMOTE_TIMEOUT`

---

## Service behavior expectations

### PostgreSQL unit

- must use `Type=notify`
- must `exec postgres` directly from the launch wrapper
- must not use `pg_ctl start` as `ExecStart`
- must use wrapper scripts for `ExecStop` and `ExecReload`
- must remain generic across PG 14 through 18

### Boot behavior

- do not enable `pgvm-postgres.service` to auto-start on boot blindly
- only `vm-control.service` should auto-start
- `vm-control` decides whether the VM already has a cluster and whether PostgreSQL should start

### Defaults

- default stop mode is `fast`
- default stop timeout is `90`
- default stop wait is `yes`

---

## Security guidance

### Prefer bounded privilege

If `vm-control` does not run as root, use a small sudo allowlist.

Allowed patterns should be limited to:

- `systemctl start/stop/restart/reload/status/show pgvm-postgres.service`
- `systemctl start/status/show pgvm-postgres-op@*.service`

Do not reintroduce arbitrary shell execution just because `supervisor.js` is gone.

### Avoid raw option pass-through

Do not add arbitrary user-supplied shell fragments into `PGOPTS` or one-shot operation env files without validation.

Map only supported, named parameters.

---

## Testing checklist

### Start

- write `cluster.env`
- start service
- verify `systemctl status pgvm-postgres.service`
- verify `pgvm-postgres-state` returns `healthy=true`

### Stop

- set `PG_STOP_MODE=smart`
- stop service
- verify clean shutdown
- repeat with `fast`
- repeat with `immediate`

### Restart

- restart service with a custom stop mode
- verify service returns to `active`

### Basebackup

- run `pgvm-postgres-op@basebackup.service`
- verify it is not under `vm-control.service` cgroup

### Rewind

- run `pgvm-postgres-op@rewind.service`
- verify logs in journald

### cgroup isolation

- verify `systemctl show vm-control.service -p ControlGroup`
- verify `systemctl show pgvm-postgres.service -p ControlGroup`
- verify they are different

### Failure semantics

- kill postgres main PID
- verify systemd marks service failed or restarts it according to unit policy
- verify `vm-control` broadcasts down/unhealthy transition

---

## Non-goals

- do not create a new replacement supervisor daemon
- do not keep PostgreSQL as a child process of Node
- do not move one-shot DB operations back into `vm-control` child processes

---

## Summary

The new standard is:

- `vm-control` is the control plane
- systemd is the PostgreSQL process supervisor
- PostgreSQL and one-shot DB operations each get their own systemd unit and cgroup
- health broadcasting is implemented in `vm-control` using systemd state and readiness checks
- `supervisor.js` is removed completely
