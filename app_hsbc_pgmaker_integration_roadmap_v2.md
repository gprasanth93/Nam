# pgaas-dhp-sidecar — Rust Requirements for Sidecar-Authenticated PostgreSQL Wire Proxy with TLS

## 1. Project Summary

Project name:

```text
pgaas-dhp-sidecar
```

Language:

```text
Rust
```

The sidecar runs inside an `app.hsbc` service VM and makes a PgMaker / DHP PostgreSQL database available locally to the application.

The application connects to:

```text
127.0.0.1:5432
```

or optionally:

```text
/run/pgaas-dhp-sidecar/postgres.sock
```

The application must not know the real database hostname, database password, or PGaaS credential flow.

The sidecar is responsible for:

```text
connect to Cranker
request credentials from PGaaS
receive credentials through replyUrl
authenticate to upstream PostgreSQL using those credentials
expose a local PostgreSQL-compatible endpoint
terminate local PostgreSQL startup/authentication
proxy PostgreSQL protocol traffic
use TLS to upstream database
optionally support TLS from local app to sidecar
handle reset/health events
log every important stage
```

---

## 2. Important Design Decision

This must **not** be a dumb TCP tunnel.

A dumb TCP tunnel cannot hide the database password from the application because PostgreSQL authentication happens inside the PostgreSQL wire protocol.

The sidecar must be a **sidecar-authenticated PostgreSQL wire proxy**.

That means:

```text
Application authenticates to sidecar locally
Sidecar authenticates to real PostgreSQL database using PGaaS credentials
After both sides are authenticated, sidecar proxies normal PostgreSQL messages
```

High-level flow:

```text
Application
    ↓ local PG startup/auth flow
pgaas-dhp-sidecar
    ↓ upstream PG startup/auth flow using PGaaS credentials over TLS
PgMaker PostgreSQL endpoint
```

---

## 3. Core Runtime Flow

```text
1. Sidecar starts.

2. Sidecar loads config from environment variables.

3. Sidecar starts callback HTTP server.

4. Sidecar connects/registers to Cranker over WSS.

5. Sidecar sends credential request to PGaaS:
      POST https://pgaas.uat.hsbc/apphsbc/{dbName}

6. PGaaS sends credentials to replyUrl through Cranker.

7. Sidecar receives Authorization event.

8. Sidecar stores DB credentials in memory only.

9. Sidecar starts local PostgreSQL wire proxy on 127.0.0.1:5432.

10. Application connects to localhost:5432.

11. Sidecar handles local PostgreSQL startup/auth.

12. Sidecar opens upstream TLS connection to real PostgreSQL database.

13. Sidecar performs upstream PostgreSQL authentication using PGaaS credential.

14. Once upstream authentication succeeds, sidecar bridges normal PostgreSQL protocol traffic.

15. Reset event triggers credential refresh and safe credential rotation.
```

---

## 4. Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│ app.hsbc Service VM                                                 │
│                                                                    │
│  ┌──────────────────────┐                                          │
│  │ User Application     │                                          │
│  │                      │                                          │
│  │ PGHOST=127.0.0.1     │                                          │
│  │ PGPORT=5432          │                                          │
│  └──────────┬───────────┘                                          │
│             │                                                      │
│             │ Local PostgreSQL wire protocol                        │
│             │ Optional local TLS                                    │
│             v                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ pgaas-dhp-sidecar                                            │   │
│  │                                                              │   │
│  │  ┌──────────────────────┐                                    │   │
│  │  │ Local PG Server       │                                    │   │
│  │  │ - SSLRequest handling │                                    │   │
│  │  │ - StartupMessage      │                                    │   │
│  │  │ - local auth          │                                    │   │
│  │  └──────────┬───────────┘                                    │   │
│  │             │                                                │   │
│  │             v                                                │   │
│  │  ┌──────────────────────┐                                    │   │
│  │  │ Upstream PG Client    │                                    │   │
│  │  │ - TLS verify-full     │                                    │   │
│  │  │ - PG startup          │                                    │   │
│  │  │ - SCRAM/password auth │                                    │   │
│  │  └──────────┬───────────┘                                    │   │
│  │             │                                                │   │
│  │             v                                                │   │
│  │  ┌──────────────────────┐                                    │   │
│  │  │ PG Message Bridge     │                                    │   │
│  │  │ - Query               │                                    │   │
│  │  │ - Parse/Bind/Execute  │                                    │   │
│  │  │ - CopyData            │                                    │   │
│  │  │ - CancelRequest map   │                                    │   │
│  │  └──────────────────────┘                                    │   │
│  │                                                              │   │
│  │  ┌──────────────────────┐     ┌──────────────────────────┐   │   │
│  │  │ Credential Manager    │◀────│ Callback Receiver         │   │   │
│  │  └──────────────────────┘     └────────────┬─────────────┘   │   │
│  │                                            │                 │   │
│  │  ┌──────────────────────┐                  │                 │   │
│  │  │ Cranker WSS Client    │◀─────────────────┘                 │   │
│  │  └──────────────────────┘                                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘

                          TLS verify-full
                                │
                                v
                    ┌────────────────────────┐
                    │ PgMaker PostgreSQL DB   │
                    │ host:port/dbname        │
                    └────────────────────────┘
```

---

## 5. Credential Callback Contract

PGaaS will send callback events through Cranker to the sidecar reply URL.

The callback body is URL-encoded:

```text
Content-Type: application/x-www-form-urlencoded
```

### Authorization event

Required format using PostgreSQL naming convention:

```text
Event=Authorization&host_name=pgmaker-db.internal&port=5432&dbname=sample_service_uat&user=sample_service_user&password=secret
```

Required fields:

| Field | Required | Description |
|---|---|---|
| `Event` | yes | Must be `Authorization` |
| `host_name` | yes | Upstream PostgreSQL hostname |
| `port` | yes | Upstream PostgreSQL port |
| `dbname` | yes | Upstream database name |
| `user` | yes | Upstream PostgreSQL role/user |
| `password` | yes | Upstream database password |

### PostgreSQL user convention

In PostgreSQL, the startup parameter is called:

```text
user
```

So the preferred callback field should be:

```text
user=<postgres_role_name>
```

For compatibility, the sidecar may also accept:

```text
user=<postgres_role_name>
```

But internally it should normalize both fields to:

```rust
DbCredentials.user
```

Recommended precedence:

```text
1. Authorization callback field: user
2. Authorization callback field: user
3. Environment variable: PGAAS_DB_USER
4. Fail validation if none is present
```

Do not guess the upstream PostgreSQL user from `dbname` unless PgMaker explicitly defines that as a platform convention.

The local application may connect using any local-facing user name, depending on the local auth mode. The sidecar must not trust the local client user as the upstream database user. Upstream authentication must always use the PgMaker / PGaaS issued PostgreSQL `user` and `password`.

### Reset event

```text
Event=Reset
```

Meaning:

```text
Current password has changed or should be refreshed.
Sidecar must request fresh credentials from PGaaS.
```

### Health event

```text
Event=Health&payload=<urlencoded-json>
```

Example decoded payload:

```json
{
  "status": "healthy",
  "lag_ms": 10,
  "role": "primary"
}
```

---

## 6. Sidecar-Authenticated PostgreSQL Wire Proxy

The proxy has two separate protocol sessions per client connection.

```text
Local client session:
  application -> sidecar

Upstream database session:
  sidecar -> PostgreSQL
```

The sidecar must not forward the client startup/authentication blindly to upstream.

Instead:

```text
1. Accept local client.
2. Read local PostgreSQL SSLRequest or StartupMessage.
3. Optionally negotiate local TLS.
4. Validate local connection policy.
5. Obtain current PGaaS credentials.
6. Open upstream TCP connection.
7. Negotiate upstream TLS.
8. Send upstream StartupMessage using PGaaS user/dbname.
9. Complete upstream password/SCRAM authentication using PGaaS password.
10. Forward post-auth server messages to client.
11. Bridge all normal frontend/backend messages.
```

---

## 7. Local PostgreSQL Server Behavior

The sidecar must behave like a minimal PostgreSQL server for the startup phase.

### 7.1 Handle SSLRequest

PostgreSQL clients may first send an SSLRequest.

SSLRequest code:

```text
80877103
```

Behavior:

```text
If local TLS is enabled:
  respond 'S'
  upgrade local connection to TLS using sidecar server certificate

If local TLS is disabled:
  respond 'N'
  continue with cleartext local connection
```

Local TLS should be optional because the default traffic is loopback inside the VM.

Recommended default:

```text
local TLS disabled
bind only to 127.0.0.1
```

Production option:

```text
local TLS enabled
or Unix socket enabled
```

### 7.2 Handle GSSENCRequest

PostgreSQL clients may send GSSENCRequest.

Behavior for MVP:

```text
respond 'N'
```

Log at debug level:

```text
gssenc_request_rejected
```

### 7.3 Handle StartupMessage

The sidecar must parse the client StartupMessage.

Fields may include:

```text
user
database
application_name
client_encoding
DateStyle
TimeZone
extra_float_digits
```

Behavior:

- Accept local startup only after credentials are available.
- Capture client parameters.
- Do not trust client `user` for upstream authentication.
- Use PGaaS-provided upstream user.
- Use PGaaS-provided upstream dbname.
- Optionally preserve safe startup parameters upstream:
  - `application_name`
  - `client_encoding`
  - `DateStyle`
  - `TimeZone`
  - `extra_float_digits`

### 7.4 Local authentication policy

Supported local auth modes:

```text
trust_local
unix_socket_peer
local_password
```

#### `trust_local`

Default MVP mode.

Allowed only when bind address is loopback or Unix socket.

Behavior:

```text
sidecar accepts local app without asking for DB password
sidecar authenticates upstream using PGaaS credentials
```

This gives the desired developer experience:

```text
application does not know database password
```

Security requirement:

```text
trust_local must never be allowed on 0.0.0.0
```

#### `unix_socket_peer`

Future stronger local mode.

Behavior:

```text
sidecar checks Unix socket peer UID/GID
only approved app user can connect
```

This is preferred for production if app.hsbc can control Linux users.

#### `local_password`

Optional future mode.

Sidecar asks client for a local-only password.

This password is not the real database password.

The local password can be configured through environment/secret injection.

---

## 8. Upstream PostgreSQL TLS Requirements

The sidecar must connect to upstream PostgreSQL using TLS.

Default upstream TLS mode:

```text
verify-full
```

This means:

```text
verify CA chain
verify server certificate hostname matches host_name
reject invalid/expired certificates
```

Required configuration:

| Variable | Description |
|---|---|
| `PGAAS_UPSTREAM_TLS_MODE` | `verify-full`, `verify-ca`, `require`, `disable` |
| `PGAAS_UPSTREAM_CA_CERT_PATH` | CA file path for upstream DB |
| `PGAAS_UPSTREAM_SERVER_NAME` | Optional override for TLS SNI/hostname verification |
| `PGAAS_UPSTREAM_TLS_MIN_VERSION` | Default `TLS1.2` or higher |

Recommended production default:

```text
PGAAS_UPSTREAM_TLS_MODE=verify-full
```

Development-only option:

```text
PGAAS_UPSTREAM_TLS_MODE=require
```

`disable` should be allowed only in explicit local development mode.

### TLS flow

```text
sidecar opens TCP connection to host_name:port
sidecar sends PostgreSQL SSLRequest
PostgreSQL responds 'S'
sidecar upgrades connection to TLS
sidecar validates certificate
sidecar sends StartupMessage
sidecar completes PostgreSQL authentication
```

If server responds `N` to SSLRequest and TLS mode is `verify-full`, `verify-ca`, or `require`, connection must fail.

---

## 9. Upstream PostgreSQL Authentication

The sidecar must support PostgreSQL password authentication flows.

Required support:

```text
AuthenticationOk
AuthenticationCleartextPassword
AuthenticationMD5Password
AuthenticationSASL
AuthenticationSASLContinue
AuthenticationSASLFinal
```

Priority:

```text
1. SCRAM-SHA-256 / SASL
2. MD5
3. Cleartext password only if TLS is active
```

Security requirement:

```text
Never send cleartext password unless upstream TLS is established.
```

Recommended crates to evaluate:

```text
postgres-protocol
postgres-types
bytes
tokio-rustls
rustls
rustls-pemfile
ring or aws-lc-rs through rustls
```

Implementation choices:

### Option A — Low-level protocol implementation

Implement PostgreSQL startup, TLS negotiation, password auth, and message bridge manually.

Pros:

```text
full control
can bridge arbitrary PostgreSQL protocol messages after auth
can support extended query protocol naturally after auth
```

Cons:

```text
more implementation complexity
must carefully test SCRAM and CancelRequest
```

### Option B — Use an existing PG wire/server crate

Evaluate crates such as:

```text
pgwire
postgres-protocol
tokio-postgres
```

But make sure the final implementation supports:

```text
startup/auth termination
upstream password auth using PGaaS password
normal query protocol bridge
extended query protocol
COPY
CancelRequest
TLS
```

Do not implement only simple query forwarding unless MVP scope explicitly allows that limitation.

---

## 10. Message Bridging After Authentication

Once upstream authentication succeeds, the sidecar can bridge normal PostgreSQL protocol messages between client and upstream.

Post-auth messages include:

Frontend to backend:

```text
Query
Parse
Bind
Describe
Execute
Sync
Flush
Close
Terminate
CopyData
CopyDone
CopyFail
FunctionCall
PasswordMessage should not appear after auth
```

Backend to frontend:

```text
RowDescription
DataRow
CommandComplete
ReadyForQuery
ErrorResponse
NoticeResponse
ParameterStatus
BackendKeyData
CopyInResponse
CopyOutResponse
CopyBothResponse
CopyData
CopyDone
NotificationResponse
```

The bridge should not need to understand every post-auth message initially, but it should copy complete PostgreSQL messages safely.

### Message framing requirement

Do not use blind `tokio::io::copy_bidirectional` after authentication unless the implementation has correctly aligned both streams after the auth phase.

Recommended approach:

```text
read complete framed PG message
write complete framed PG message
track direction
track connection state
log high-level state, not payload
```

This makes it easier to:

```text
handle Terminate
track ReadyForQuery
map CancelRequest
count messages
debug protocol failures
```

For high performance later, raw bidirectional copy may be acceptable after protocol alignment is proven, but framed bridging is safer for the first production-ready implementation.

---

## 11. BackendKeyData and CancelRequest

PostgreSQL CancelRequest is a separate startup-like packet.

If the local app sends a CancelRequest to `localhost:5432`, the sidecar must handle it.

CancelRequest code:

```text
80877102
```

### Required behavior

During upstream authentication, PostgreSQL sends `BackendKeyData`.

The sidecar should:

```text
capture upstream process_id and secret_key
forward BackendKeyData to local client
store mapping for active session
```

If a new local connection sends CancelRequest:

```text
sidecar reads process_id and secret_key
looks up active upstream session
opens new TCP/TLS connection to upstream
sends CancelRequest to upstream using same process_id and secret_key
closes cancel connection
```

If mapping is not found:

```text
log cancel_request_unknown
close connection
```

### Metrics

Track:

```text
sidecar_pg_cancel_requests_total
sidecar_pg_cancel_forwarded_total
sidecar_pg_cancel_unknown_total
sidecar_pg_cancel_failed_total
```

---

## 12. Credential Rotation, Password Reset, and Disaster Recovery

PgMaker may rotate/reset the database password periodically, for example every 24 hours.

When the password is reset, PgMaker sends:

```text
Event=Reset
```

### 12.1 Password reset rule

A reset event must **not** disconnect active PostgreSQL sessions.

This is a hard requirement.

Correct behavior:

```text
Active PostgreSQL session already connected through sidecar
        ↓
PgMaker sends Reset event
        ↓
Sidecar marks current credential stale for new sessions only
        ↓
Sidecar requests fresh credentials from PGaaS / PgMaker
        ↓
Existing PostgreSQL sessions continue uninterrupted
        ↓
New PostgreSQL sessions wait for fresh credentials
        ↓
New Authorization event arrives
        ↓
Sidecar atomically swaps to new credentials
        ↓
Only new PostgreSQL sessions use the new credentials
```

Incorrect behavior:

```text
Reset event received
        ↓
Sidecar disconnects active client sessions
```

Do not do this.

### 12.2 Required reset behavior

```text
1. Log reset_event_received.
2. Mark current credentials as stale_for_new_sessions.
3. Do not close active PostgreSQL sessions.
4. Trigger a fresh credential request to PGaaS / PgMaker.
5. New client sessions should wait for fresh credentials.
6. If fresh credentials are not available yet, new sessions should wait up to configured timeout or fail gracefully.
7. Existing sessions continue until the application closes them or the database/network closes them.
8. Once a new Authorization event arrives, atomically replace credentials.
9. New sessions use the new credential version.
```

### 12.3 Remove close-on-reset mode

Do not implement a reset policy that closes active sessions just because a password reset event was received.

Remove this older model:

```text
SIDECAR_EXISTING_CONNECTION_POLICY_ON_RESET=drain|close
```

Replace it with:

```text
SIDECAR_RESET_NEW_SESSION_POLICY=wait_for_fresh_credentials|allow_stale_until_fresh
```

Recommended default:

```text
SIDECAR_RESET_NEW_SESSION_POLICY=wait_for_fresh_credentials
```

Meaning:

```text
existing sessions continue
new sessions wait until fresh credentials are received
```

Optional mode:

```text
SIDECAR_RESET_NEW_SESSION_POLICY=allow_stale_until_fresh
```

This means new sessions may temporarily use the existing stale credential while fresh credentials are being fetched. Use this only if PgMaker guarantees old passwords remain valid for a grace period after reset.

Recommended production mode:

```text
wait_for_fresh_credentials
```

### 12.4 Credential versions

Every Authorization event should create a new credential version.

Example:

```text
credential_version=1
credential_version=2
credential_version=3
```

Each active PostgreSQL session should be tagged internally with the credential version used when it was created.

Example log context:

```text
client_session_id=...
credential_version=3
upstream_host=...
upstream_dbname=...
```

This allows operators to understand which connections are still using old credentials after a reset.

### 12.5 Disaster recovery / failover behavior

During a disaster event, PgMaker may promote a standby to become the new primary.

During this window:

```text
existing database connections may drop
new upstream connections may fail
PGaaS / PgMaker may not immediately return fresh credentials
credential callbacks may be delayed
database hostname/port may change
database role may be temporarily unavailable
```

The sidecar must handle this as a degraded but recoverable state.

Required behavior during DR/failover:

```text
1. Detect upstream connection loss.
2. Log upstream_connection_lost with reason.
3. Mark readiness as degraded or not ready.
4. Continue running the sidecar process.
5. Keep Cranker connection alive if possible.
6. Keep retrying credential request to PGaaS / PgMaker using exponential backoff.
7. Keep accepting local client connections only if configured to wait; otherwise fail fast with a clear PostgreSQL ErrorResponse.
8. When PgMaker finishes promotion and sends fresh Authorization credentials, update credential state.
9. New sessions should connect to the promoted primary using new credentials.
10. Sidecar should become ready again.
```

The sidecar should not crash during failover.

### 12.6 Retry behavior during failover

When PGaaS / PgMaker is temporarily unable to deliver credentials:

```text
retry forever with backoff
do not tight-loop
do not exit
log each retry at controlled intervals
expose degraded state in /ready and /health/details
```

Recommended backoff:

```text
initial_backoff = 1s
max_backoff = 60s
jitter = enabled
```

Recommended log events:

```text
disaster_or_failover_suspected
upstream_connection_lost
credential_refresh_retrying
credential_refresh_delayed
credential_refresh_received_after_failover
sidecar_recovered
```

### 12.7 Local client behavior during failover

For new local client connections while credentials or primary endpoint are unavailable:

Recommended behavior:

```text
accept connection
attempt to wait for fresh credentials up to SIDECAR_CREDENTIAL_WAIT_SECONDS
if unavailable, return PostgreSQL ErrorResponse and close
```

ErrorResponse should be PostgreSQL-compatible and clear:

```text
severity = ERROR
sqlstate = 08006
message = database temporarily unavailable while PgMaker is recovering or promoting standby
detail = sidecar is waiting for fresh credentials from PGaaS/PgMaker
hint = retry connection after a short delay
```

Do not expose internal secrets in the error response.

---

## 13. Configuration

Required environment variables:

| Variable | Description | Example |
|---|---|---|
| `PGAAS_BASE_URL` | PGaaS base URL | `https://pgaas.uat.hsbc` |
| `PGAAS_DB_NAME` | Requested database name | `sample_service_uat` |
| `PGAAS_REPLY_URL` | Reply URL exposed through Cranker | `https://reply-url/apphsbc/sample-service/db` |
| `GIT_REPO_ID` | Git repository ID | `123456` |
| `GIT_REPO_NAME` | Git repository name | `sample-service` |
| `EIMID` | Application/service EIM ID | `EIM1234567` |
| `CRANKER_WSS_URL` | Cranker WSS registration URL | `wss://cranker.uat.hsbc/register` |

Strongly recommended:

| Variable | Description |
|---|---|
| `PGAAS_UPSTREAM_CA_CERT_PATH` | CA used to verify upstream PostgreSQL TLS |
| `PGAAS_UPSTREAM_TLS_MODE` | Default `verify-full` |

Optional:

| Variable | Default | Description |
|---|---:|---|
| `SIDECAR_HTTP_BIND_ADDR` | `127.0.0.1:8080` | Callback/health server |
| `SIDECAR_PROXY_BIND_ADDR` | `127.0.0.1:5432` | Local PG proxy |
| `SIDECAR_LOCAL_AUTH_MODE` | `trust_local` | `trust_local`, `unix_socket_peer`, `local_password` |
| `SIDECAR_ENABLE_LOCAL_TLS` | `false` | Enable TLS from app to sidecar |
| `SIDECAR_LOCAL_TLS_CERT_PATH` | empty | Local TLS server cert |
| `SIDECAR_LOCAL_TLS_KEY_PATH` | empty | Local TLS key |
| `SIDECAR_ENABLE_UNIX_SOCKET` | `false` | Enable Unix socket |
| `SIDECAR_UNIX_SOCKET_PATH` | empty | Socket path |
| `SIDECAR_LOG_LEVEL` | `info` | Log level |
| `SIDECAR_LOG_FORMAT` | `json` | `json` or `pretty` |
| `SIDECAR_CREDENTIAL_TIMEOUT_SECONDS` | `120` | First credential wait timeout |
| `SIDECAR_UPSTREAM_CONNECT_TIMEOUT_SECONDS` | `5` | DB connect timeout |
| `SIDECAR_RESET_NEW_SESSION_POLICY` | `wait_for_fresh_credentials` | New session behavior after reset: `wait_for_fresh_credentials` or `allow_stale_until_fresh` |
| `SIDECAR_WORKER_THREADS` | number of CPUs | Tokio worker threads |

---

## 14. PGaaS Credential Request

The sidecar requests credentials from PGaaS.

Endpoint:

```text
POST https://pgaas.uat.hsbc/apphsbc/{dbName}
```

Example:

```text
POST https://pgaas.uat.hsbc/apphsbc/sample_service_uat
```

JSON body:

```json
{
  "replyUrl": "https://cranker-reply.uat.hsbc/apphsbc/sample-service/db",
  "git_repo_id": "123456",
  "git_repo_name": "sample-service",
  "EIMID": "EIM1234567"
}
```

Requirements:

```text
use HTTPS
include correlation ID
retry network/5xx/429 failures
do not retry permanent 4xx by default
log request start/success/failure
do not log secrets
```

Recommended headers:

```text
Content-Type: application/json
Accept: application/json
X-Correlation-Id: <uuid>
X-Sidecar-Name: pgaas-dhp-sidecar
X-Git-Repo-Id: <git_repo_id>
X-Git-Repo-Name: <git_repo_name>
X-EIMID: <eimid>
```

---

## 15. Cranker Registration

The sidecar must connect to Cranker using WSS.

Exact Cranker details will be added later, so implement behind a trait.

```rust
#[async_trait::async_trait]
pub trait CrankerClient {
    async fn connect_and_register(&self) -> Result<(), CrankerError>;
    async fn wait_until_registered(&self) -> Result<(), CrankerError>;
}
```

Requirements:

```text
connect to CRANKER_WSS_URL
register replyUrl
reconnect on disconnect
use exponential backoff with jitter
expose connection state in health endpoint
log all state transitions
```

Credential request should happen only after Cranker registration unless config allows otherwise.

---

## 16. Rust Module Layout

Recommended layout:

```text
pgaas-dhp-sidecar/
  Cargo.toml
  README.md
  src/
    main.rs
    config.rs
    error.rs
    logging.rs
    state.rs

    pgaas_client.rs
    cranker_client.rs
    callback_server.rs
    credential_manager.rs

    pg_proxy/
      mod.rs
      listener.rs
      local_startup.rs
      local_tls.rs
      upstream_connect.rs
      upstream_tls.rs
      upstream_auth.rs
      bridge.rs
      cancel.rs
      messages.rs

    health.rs
    metrics.rs
    retry.rs
    shutdown.rs
```

---

## 17. Suggested Crates

Recommended crates to evaluate:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.7"
hyper = "1"
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
tokio-tungstenite = "0.24"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_urlencoded = "0.7"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
thiserror = "1"
anyhow = "1"
uuid = { version = "1", features = ["v4", "serde"] }
bytes = "1"
secrecy = "0.8"
zeroize = "1"
rustls = "0.23"
tokio-rustls = "0.26"
rustls-pemfile = "2"
webpki-roots = "0.26"
postgres-protocol = "0.6"
rand = "0.8"
chrono = { version = "0.4", features = ["serde"] }
prometheus = "0.13"
```

Use latest compatible versions when generating actual code.

---

## 18. State Machine

Each client connection should follow this state machine:

```text
Accepted
  ↓
ReadInitialPacket
  ├── SSLRequest -> LocalTlsNegotiation -> ReadStartupMessage
  ├── GSSENCRequest -> RejectGss -> ReadStartupMessage
  ├── CancelRequest -> HandleCancel -> Close
  └── StartupMessage -> LocalAuth
        ↓
WaitForCredentials
        ↓
ConnectUpstreamTcp
        ↓
UpstreamSslRequest
        ↓
UpstreamTlsHandshake
        ↓
UpstreamStartupMessage
        ↓
UpstreamAuthentication
        ↓
ForwardServerInitMessages
        ↓
BridgeMessages
        ↓
Close
```

---

## 19. Logging Requirements

Use structured logging with `tracing`.

Must log these stages:

```text
sidecar_starting
config_loaded
callback_server_started
cranker_connecting
cranker_registered
credential_request_started
credential_request_succeeded
credential_waiting
credential_received
pg_proxy_listener_started
client_connection_accepted
local_ssl_request_received
local_tls_enabled
local_tls_disabled
startup_message_received
local_auth_succeeded
upstream_connecting
upstream_tcp_connected
upstream_ssl_request_sent
upstream_tls_established
upstream_tls_verify_failed
upstream_startup_sent
upstream_auth_started
upstream_auth_succeeded
backend_key_data_received
bridge_started
bridge_completed
reset_event_received
credentials_marked_stale
credential_refresh_requested
credential_version_updated
cancel_request_received
cancel_request_forwarded
health_event_received
sidecar_shutdown_started
sidecar_shutdown_completed
```

Never log:

```text
password
full Authorization callback payload
TLS private key
auth token
secret headers
```

Redact password if payload is ever logged:

```text
password=<redacted>
```

---

## 20. Health and Readiness

Endpoints:

```text
GET /live
GET /ready
GET /health
GET /health/details
GET /metrics
POST /callback/pgaas
```

`/ready` returns `200` only if:

```text
Cranker is registered
credentials are ready
local proxy listener is running
upstream TLS probe succeeds, if enabled
```

Example details:

```json
{
  "status": "ready",
  "sidecar": "pgaas-dhp-sidecar",
  "git_repo_id": "123456",
  "git_repo_name": "sample-service",
  "EIMID": "EIM1234567",
  "cranker": {
    "state": "registered"
  },
  "credentials": {
    "state": "ready",
    "version": 2,
    "host_name": "pgmaker-db.internal",
    "port": 5432,
    "dbname": "sample_service_uat",
    "user": "sample_service_user",
    "received_at": "2026-06-03T12:00:10Z"
  },
  "proxy": {
    "bind_addr": "127.0.0.1:5432",
    "local_tls_enabled": false,
    "upstream_tls_mode": "verify-full",
    "active_connections": 4
  }
}
```

Do not expose password.

---

## 21. Metrics

Expose Prometheus metrics:

```text
sidecar_ready
sidecar_cranker_connected
sidecar_credentials_received_total
sidecar_credentials_reset_total
sidecar_current_credential_version
sidecar_pg_proxy_active_connections
sidecar_pg_proxy_connections_total
sidecar_pg_proxy_connection_failures_total
sidecar_pg_upstream_connect_total
sidecar_pg_upstream_connect_failure_total
sidecar_pg_upstream_tls_success_total
sidecar_pg_upstream_tls_failure_total
sidecar_pg_upstream_auth_success_total
sidecar_pg_upstream_auth_failure_total
sidecar_pg_cancel_requests_total
sidecar_pg_cancel_forwarded_total
sidecar_pg_cancel_failed_total
sidecar_callback_events_total
sidecar_callback_invalid_events_total
```

---

## 22. Retry Requirements

Retry with exponential backoff and jitter for:

```text
Cranker WSS reconnect
PGaaS credential request
initial credential wait
upstream TCP connect
upstream TLS handshake
upstream authentication
```

Defaults:

```text
initial_backoff = 500ms
max_backoff = 30s
jitter = enabled
```

For upstream connection per client:

```text
retry small number of times
fail client connection if upstream cannot be reached
log failure clearly
```

Do not spin forever in a tight loop.

---

## 23. Security Requirements

```text
Do not log passwords.
Do not write passwords to disk.
Store password using secrecy::SecretString or equivalent.
Bind local proxy to 127.0.0.1 by default.
Reject trust_local mode if bind address is not loopback.
Require upstream TLS by default.
Verify upstream certificate by default.
Reject invalid upstream certificates.
Never send cleartext password unless TLS is established.
Support Unix socket with restrictive permissions.
Do not expose debug endpoints unless explicitly enabled.
Limit callback request body size.
Validate all callback fields.
Reject unknown events.
Support future OIDC/mTLS headers in PGaaS client.
```

---

## 24. Testing Requirements

### Unit tests

Add tests for:

```text
config parsing
missing env vars
Authorization callback parsing
missing user/password validation
Reset event handling
Health event parsing
credential state transitions
SSLRequest parsing
GSSENCRequest parsing
CancelRequest parsing
StartupMessage parsing
TLS mode validation
retry policy
```

### Integration tests

Add tests for:

```text
mock PGaaS credential request
mock Authorization callback
mock Reset callback
mock Cranker registration
proxy starts after credentials
proxy rejects connection before credentials or waits correctly
upstream TLS required
upstream TLS verify failure
upstream auth failure
credential rotation
CancelRequest forwarding
```

### E2E test

Run local PostgreSQL with TLS enabled.

Test:

```text
1. Start sidecar.
2. Send Authorization event with real local Postgres TLS endpoint.
3. Connect psql to localhost:5432.
4. Run SELECT 1.
5. Trigger Reset event.
6. Send new Authorization event.
7. New psql connection should succeed.
8. Old connection behavior follows drain/close policy.
```

Example local client command:

```bash
psql "host=127.0.0.1 port=5432 dbname=sample_service_uat user=app_user sslmode=disable"
```

The `user=app_user` here is local-facing. It does not need to be the real upstream database user.

---

## 25. MVP Boundary

For the first production-ready MVP, implement:

```text
Cranker WSS client skeleton
PGaaS credential request
URL-encoded callback receiver
Authorization / Reset / Health events
credential manager
local PostgreSQL startup handling
local trust auth on 127.0.0.1 only
upstream TLS verify-full
upstream password/SCRAM auth using PGaaS credentials
post-auth PG message bridge
CancelRequest support
health/readiness/metrics
structured logging
graceful shutdown
```

Do not implement in MVP unless explicitly requested:

```text
OIDC
mTLS bootstrap
PG18 OAuth login
pgaas.json reconciliation
firewall updates
VM config updates
read/write routing
multi-database multiplexing
advanced SQL parsing
query-aware routing
```

---

## 26. Final Expected Lifecycle

The final sidecar lifecycle must be:

```text
Start pgaas-dhp-sidecar
    ↓
Connect/register to Cranker
    ↓
Request credentials from PGaaS
    ↓
Wait for Authorization event
    ↓
Store credentials in memory
    ↓
Start local PG wire proxy
    ↓
Local app connects to localhost:5432
    ↓
Sidecar handles local PG startup/auth
    ↓
Sidecar connects upstream using TLS verify-full
    ↓
Sidecar authenticates upstream using PGaaS credentials
    ↓
Sidecar bridges PG messages
    ↓
Reset event refreshes credentials without disconnecting active sessions
    ↓
Existing sessions continue on their original upstream connection
    ↓
New connections use updated credentials
    ↓
If disaster/failover breaks upstream connections, sidecar keeps retrying PGaaS/PgMaker until fresh credentials for the promoted primary arrive
```

This is the required design:

```text
Local app does not know DB password.
Sidecar owns upstream DB authentication.
Upstream connection is TLS verified.
PostgreSQL wire protocol remains compatible with normal clients.
```
