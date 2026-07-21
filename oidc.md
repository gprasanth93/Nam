Below are **presentation-ready diagrams** you can use in your sharing session.

# 1. Workload identity with `simple-kvm-deployer`

This is the clean model for **app.hsbc service VM running on Firecracker**.

```mermaid
flowchart TD
    A[app.hsbc Deployment Request] --> B[simple-kvm-deployer on selected host]

    B --> C[Create service_vm_id]
    B --> D[Create host-local metadata]
    B --> E[Create TAP / MAC / IP / vsock CID]
    B --> F[Start Firecracker microVM]

    D --> D1["service_vm_id = svc-vm-abc123<br/>git_repo_id = 123456<br/>EIMID = EIM1234567<br/>namespace = payments-uat<br/>vsock_cid = 3245"]

    F --> G[Service VM boots]

    G --> H[pgaas-dhp-sidecar starts]
    H --> I[Read non-secret metadata from MMDS/env]
    H --> J[Request workload token over vsock]

    J --> K[simple-kvm-deployer / host identity endpoint]
    K --> L["Identify caller by host-controlled source<br/>vsock CID / socket path / TAP mapping"]

    L --> M[Lookup host-local metadata]
    M --> N[Ask Central DHP Trust for token]

    N --> O[Central DHP / app.hsbc Trust]
    O --> P[Sign short-lived JWT]

    P --> H
    H --> Q[pgaas-access-broker<br/>pgaas-creds.env.digital.hsbc]

    Q --> R[Validate token later]
    Q --> S[Resolve config in pgaas-config]
    Q --> T[Ask PgMaker to create DB / request creds]

    T --> U[PgMaker]
    U --> V[PgMaker delivers credentials to sidecar replyUrl]

    V --> H
    H --> W[Sidecar opens localhost:5432]
    W --> X[Application connects locally]
```

## Simple explanation for audience

Use this line:

> Firecracker runs the VM, but `simple-kvm-deployer` knows **which VM belongs to which repo, EIMID and namespace**.

The VM should not simply say:

```text
I am repo 123456.
```

Instead, the host proves it:

```text
This token request came from vsock CID 3245.
CID 3245 belongs to service_vm_id svc-vm-abc123.
svc-vm-abc123 belongs to repo 123456 and EIM1234567.
```

That is the trust chain.

---

# 2. Trust chain diagram

This is the most important security diagram.

```mermaid
flowchart LR
    A[Sidecar inside VM] -->|Token request over vsock| B[Host identity endpoint]

    B -->|Host-controlled mapping| C["service_vm_id<br/>vsock CID<br/>tap<br/>IP<br/>MAC"]

    C --> D["Trusted host metadata<br/>repo_id<br/>EIMID<br/>namespace<br/>app"]

    D -->|Request token| E[Central Trust]

    E -->|Signed JWT| A

    A -->|JWT + repo/EIMID request| F[pgaas-access-broker]

    F -->|Validate issuer, audience, expiry, claims| G[Allow request]

    G --> H[pgaas-config + PgMaker]
```

## Key message

```text
MMDS tells the guest what it is configured as.
vsock proves to the host which VM is asking.
Central trust signs the identity.
pgaas-access-broker validates the token.
PgMaker acts only after trust is established.
```

---

# 3. What should be stored where

Use this diagram when explaining “who owns what.”

```mermaid
flowchart TD
    A[simple-kvm-deployer host-local metadata] --> A1["Runtime mapping<br/>service_vm_id<br/>tap / MAC / IP<br/>vsock CID<br/>repo_id<br/>EIMID"]

    B[Firecracker MMDS / env inside VM] --> B1["Non-secret config<br/>repo_id<br/>EIMID<br/>identity endpoint<br/>pgaas-creds URL"]

    C[Central DHP Trust] --> C1["Signing keys<br/>trusted hosts<br/>token issuance<br/>JWKS"]

    D[pgaas-config] --> D1["Git-backed desired state<br/>repo/EIMID to dbname mapping<br/>Postgres config<br/>VM config<br/>network config"]

    E[PgMaker] --> E1["DB lifecycle<br/>DB creation<br/>credential generation<br/>credential delivery"]
```

## One-liner

> Runtime identity lives with the host. Desired database state lives in `pgaas-config`. Credentials live only in PgMaker.

---

# 4. Workload identity sequence diagram

This is useful for developers.

```mermaid
sequenceDiagram
    participant App as Application
    participant Sidecar as pgaas-dhp-sidecar
    participant Host as simple-kvm-deployer / Host Identity
    participant Trust as Central DHP Trust
    participant Broker as pgaas-access-broker
    participant Config as pgaas-config
    participant PgMaker as PgMaker

    App->>Sidecar: Connect to localhost:5432
    Sidecar->>Sidecar: Read MMDS/env metadata
    Sidecar->>Host: Request workload token over vsock
    Host->>Host: Map vsock CID to service_vm_id
    Host->>Host: Read repo_id/EIMID from host metadata
    Host->>Trust: Request signed token
    Trust-->>Host: Short-lived JWT
    Host-->>Sidecar: Return JWT

    Sidecar->>Broker: Request DB access with JWT + repo_id + EIMID + replyUrl
    Broker->>Broker: Validate token later
    Broker->>Config: Resolve or create DB mapping
    Config-->>Broker: dbname + config status

    alt DB does not exist
        Broker->>PgMaker: Ensure/create database
        PgMaker-->>Broker: operation_id
        Broker->>PgMaker: Poll operation status
        PgMaker-->>Broker: DB ready
    end

    Broker->>PgMaker: Forward credential request with replyUrl
    PgMaker-->>Sidecar: Deliver credentials to replyUrl
    Sidecar->>PgMaker: Connect upstream using credentials
    App->>Sidecar: Continue using localhost:5432
```

---

# 5. Cross-platform workload identity

This is the future model where service can run in **app.hsbc, IKP, or GCP**, but database can still be PgMaker.

```mermaid
flowchart TD
    A1[app.hsbc Service VM] --> B1[app.hsbc Workload Identity]
    A2[IKP Service / Pod / VM] --> B2[IKP Workload Identity]
    A3[GCP Service] --> B3[GCP Workload Identity]

    B1 --> C[PGaaS Federation Layer]
    B2 --> C
    B3 --> C

    C --> D["Normalize identity claims<br/>source_platform<br/>repo_id<br/>EIMID<br/>namespace<br/>app_name<br/>environment"]

    D --> E[pgaas-access-broker]

    E --> F[pgaas-config]
    E --> G[PgMaker]

    G --> H[Credentials delivered to sidecar replyUrl]
```

## Explain like this

Each platform has its own way to prove workload identity:

```text
app.hsbc: Firecracker VM + simple-kvm-deployer + central trust
IKP: Kubernetes/service workload identity
GCP: GCP service account / workload identity
```

But PGaaS should normalize them into one common identity shape:

```json
{
  "source_platform": "ikp",
  "git_repo_id": "123456",
  "EIMID": "EIM1234567",
  "namespace": "payments-uat",
  "app_name": "payment-service",
  "environment": "uat"
}
```

Then `pgaas-access-broker` does not care where the app is running. It only cares whether the workload identity is trusted and whether the app is allowed to access the DB.

---

# 6. Cross-platform sequence diagram

```mermaid
sequenceDiagram
    participant Runtime as Service Runtime<br/>app.hsbc / IKP / GCP
    participant Sidecar as PGaaS Sidecar
    participant Identity as Platform Identity Provider
    participant Federation as PGaaS Federation / Broker
    participant Config as pgaas-config
    participant PgMaker as PgMaker

    Runtime->>Sidecar: Start sidecar with app metadata
    Sidecar->>Identity: Request workload identity token
    Identity-->>Sidecar: Platform token

    Sidecar->>Federation: Request DB access with platform token
    Federation->>Federation: Validate source platform issuer
    Federation->>Federation: Normalize claims

    Federation->>Config: Resolve repo/EIMID to DB mapping
    Config-->>Federation: dbname + config status

    alt Database not ready
        Federation->>PgMaker: Ensure/create database
        PgMaker-->>Federation: operation_id
        Federation->>PgMaker: Poll until ready
        PgMaker-->>Federation: DB ready
    end

    Federation->>PgMaker: Forward credential request + replyUrl
    PgMaker-->>Sidecar: Deliver credentials directly
    Sidecar->>PgMaker: Connect to database
```

---

# 7. Best slide version

For a company-wide session, use this simplified diagram:

```mermaid
flowchart LR
    A[Application] --> B[localhost:5432]
    B --> C[PGaaS Sidecar]

    C --> D[Workload Identity]
    D --> E[pgaas-access-broker]

    E --> F[pgaas-config]
    E --> G[PgMaker]

    F --> H[DB mapping and config]
    G --> I[DB creation and credentials]

    I --> C
```

Narration:

> The application only sees localhost.
> The sidecar proves who the workload is.
> The broker resolves what database the app should use.
> PgMaker creates the database and sends credentials directly to the sidecar.

---

# 8. Most important takeaway slide

```mermaid
flowchart TD
    A[Who is asking?] --> B[Workload Identity]
    B --> C[What DB should they use?]
    C --> D[pgaas-config]
    D --> E[Is the DB ready?]
    E --> F[PgMaker]
    F --> G[Credentials delivered to sidecar]
    G --> H[Application connects to localhost]
```

Use this as your closing architecture slide.

Final message:

> Workload identity answers **who is asking**.
> `pgaas-config` answers **which database belongs to them**.
> PgMaker answers **how to create and secure that database**.
> The sidecar makes it all feel like `localhost`.
