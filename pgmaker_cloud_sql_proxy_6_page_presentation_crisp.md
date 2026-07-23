# PgMaker Cloud-Like SQL Proxy — 6-Page Presentation

---

## Page 1 — The Problem

### Today, database onboarding has too much friction

```text
Developer writes code
        ↓
Needs database
        ↓
Requests DB / waits
        ↓
Gets host, port, user, password
        ↓
Stores secrets and config
        ↓
Handles rotation, failover, firewall
```

### Message to say

> “The app team wants to build features. But before that, they need to understand database provisioning, credentials, connection details, and rotation. This is the pain we are trying to hide.”

---

## Page 2 — The New Experience

### Cloud-like DB access inside PgMaker

```text
Application
    ↓
localhost:5432
    ↓
PGaaS sidecar
    ↓
PgMaker database
```

### What changes?

```text
No DB hostname in app code
No password in app config
No manual DB discovery
No direct PgMaker complexity for developers
```

### Message to say

> “The application only connects to localhost. The sidecar and PgMaker handle everything behind the scenes.”

---

## Page 3 — Main Flow

### When the service starts

```text
Service VM starts
    ↓
Sidecar starts
    ↓
Sidecar sends:
  repo_id + EIMID + replyUrl
    ↓
pgaas-access-broker
    ↓
pgaas-config resolves DB mapping
    ↓
PgMaker creates DB if needed
    ↓
PgMaker sends creds to sidecar
```

### Important point

```text
Sidecar does not know dbname.
Broker resolves it.
PgMaker owns credentials.
```

### Message to say

> “The sidecar asks for access. It does not decide the database. PGaaS resolves the mapping and PgMaker handles the database.”

---

## Page 4 — Request Queue / Staging

### If 20 service VMs start together

```text
20 sidecars request credentials
        ↓
Same repo_id + EIMID
        ↓
One active workflow
        ↓
19 requests wait in queue
        ↓
DB ready
        ↓
All requests forwarded to PgMaker
        ↓
PgMaker sends creds to each sidecar
```

### Why this matters

```text
No duplicate DB creation
No PgMaker request storm
No config collision
No blocked queue forever
```

### Message to say

> “We stage requests per repo/EIMID. One request does the heavy work. The rest wait safely and then continue once the database is ready.”

---

## Page 5 — Config and Database Mapping

### pgaas-config owns desired state

```text
repo_id + EIMID + env
        ↓
dbname
        ↓
postgres config
        ↓
vm config
        ↓
network config
```

### If config is missing

```text
Create default config
Generate readable unique DB name
Store mapping in pgaas-config
Ask PgMaker to create DB
```

### Example DB name

```text
pg_payment_service_uat_a8f31c2d
```

### Message to say

> “Repo ID is stable. Repo name is useful for readability. So the database name is readable, but uniqueness comes from a stable hash.”

---

## Page 6 — Future: Workload Identity + Cross Platform

### app.hsbc Firecracker model

```text
simple-kvm-deployer
        ↓
Tags VM with repo_id + EIMID
        ↓
Sidecar asks token from host
        ↓
Central trust signs token
        ↓
pgaas-access-broker validates token
```

### Cross-platform model

```text
app.hsbc / IKP / GCP
        ↓
Platform workload identity
        ↓
PGaaS normalizes identity
        ↓
pgaas-access-broker
        ↓
pgaas-config + PgMaker
```

### Closing message

```text
Developers connect to localhost.
PGaaS resolves the database.
PgMaker provisions and secures it.
Workload identity makes it trusted.
```

### Message to say

> “This is not only for app.hsbc. The same pattern can work cross-platform as long as each platform can prove workload identity.”
