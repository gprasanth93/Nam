# app.hsbc + PGaaS DHP / PgMaker Integration Roadmap

## 1. Purpose

This document lays out the milestone and phased implementation plan to integrate **PGaaS DHP / PgMaker** with **app.hsbc**.

The long-term goal is to make database access seamless for applications onboarded to app.hsbc.

app.hsbc is treated as the application platform where teams bring their service code, and the platform takes care of:

- Deployment
- Runtime management
- Resilience
- Platform-side operational controls
- Standardized service onboarding

The proposed PgMaker integration adds a database capability into this onboarding flow.

---

## 2. Dream Implementation

When a user onboards an application to app.hsbc, they should go through a guided onboarding flow.

One of the onboarding questions should be:

> **Do you need a database?**

If the user selects **Yes**, app.hsbc should route the request to **PGaaS**, where multiple database platforms may be available, such as:

- DHP / PgMaker
- IKP
- GCP

For DHP / PgMaker, the target experience is:

```text
User brings application code to app.hsbc
        ↓
During onboarding, user selects "Database required = Yes"
        ↓
app.hsbc passes app metadata to PGaaS / PgMaker
        ↓
PgMaker creates database configuration and provisions DB
        ↓
app.hsbc deploys the application VM with PgMaker sidecar
        ↓
Sidecar fetches DB credentials from PgMaker / PGaaS
        ↓
Application connects to localhost:5432
        ↓
Sidecar proxies traffic to the real database
```

From the application point of view, the database should look like it is available locally:

```text
host = localhost
port = 5432
database = <generated-db-name>
```

The application should not need to know the real PgMaker database host, PgBouncer port, PgCat route, or database credentials directly.

---

## 3. MVP Scope

The MVP will focus on proving the integration path from app.hsbc onboarding to local database connectivity inside the application VM.

For MVP, the database onboarding question can be a simple boolean:

```text
Do you need a database? Yes / No
```

If the answer is **Yes**, app.hsbc and PgMaker will perform the minimum required steps to create a database config, deploy the sidecar, request credentials, and expose the database locally to the application.

The MVP target is **3 weeks**.

---

## 4. MVP Implementation Milestones — 3 Weeks

### Milestone 1: app.hsbc Onboarding Contract

**Goal:**  
Define the minimum contract between app.hsbc and PGaaS / PgMaker.

For MVP, app.hsbc should pass enough metadata for PgMaker to create a basic database configuration.

Example metadata:

```json
{
  "application_name": "sample-service",
  "namespace": "sample-namespace",
  "environment": "uat",
  "cluster_info": {
    "cluster_name": "cluster-01",
    "region": "uk",
    "dc": "dc1"
  },
  "owner": "team-name",
  "database_required": true,
  "platform": "dhp-pgmaker"
}
```

**Work items:**

- Add database required flag in app.hsbc onboarding.
- Define metadata contract between app.hsbc and PGaaS.
- Define how app.hsbc routes the request to PGaaS.
- Define how PGaaS chooses DHP / PgMaker as the target platform.
- Define error handling if PgMaker cannot create the config.

**MVP output:**

```text
app.hsbc can send a database onboarding request to PGaaS / PgMaker.
```

**Acceptance criteria:**

- app.hsbc captures `database_required = true`.
- app.hsbc passes namespace and cluster metadata.
- PGaaS / PgMaker receives a valid onboarding request.
- Request can be traced using a request ID / correlation ID.

---

### Milestone 2: PgMaker Config Creation

**Goal:**  
Based on app.hsbc onboarding metadata, PgMaker should create a basic database configuration.

PgMaker should use the metadata to create a config entry that represents the requested database.

Example config:

```json
{
  "application_name": "sample-service",
  "namespace": "sample-namespace",
  "environment": "uat",
  "database_name": "sample_service_uat",
  "platform": "dhp-pgmaker",
  "status": "config_created"
}
```

**Work items:**

- Create PgMaker API to receive onboarding metadata.
- Validate required fields.
- Generate database name using a standard naming convention.
- Create basic PgMaker config entry.
- Store namespace, cluster, environment, owner, and database metadata.
- Return config creation status back to PGaaS / app.hsbc.

**MVP output:**

```text
PgMaker can create a basic database config from app.hsbc metadata.
```

**Acceptance criteria:**

- PgMaker config is created from onboarding metadata.
- Database name is generated automatically.
- Duplicate requests are idempotent.
- Failed requests return clear error messages.
- Audit entry is created for config creation.

---

### Milestone 3: Default Database Provisioning

**Goal:**  
Create a default database using the generated PgMaker configuration.

For MVP, PgMaker should provision a basic database with default configuration.

Example defaults:

```text
Database type: PostgreSQL
Database name: generated by PgMaker
Role model: basic application role
Connectivity: through PgMaker managed endpoint
Credential model: PgMaker issued credential
```

**Work items:**

- Define default database template.
- Create database based on generated config.
- Create required database user / role.
- Store database endpoint metadata.
- Make database connection details available to PgMaker credential service.
- Return provisioning status to PGaaS / app.hsbc.

**MVP output:**

```text
A default database is created for the onboarded application.
```

**Acceptance criteria:**

- Database is provisioned successfully.
- Application role is created.
- Credential request path is available.
- Database endpoint is registered in PgMaker.
- app.hsbc can query provisioning status.

---

### Milestone 4: pgaas-dhp-sidecar Packaging

**Goal:**  
Create a Rust-based sidecar that can run inside the app.hsbc application VM.

Proposed sidecar name:

```text
pgaas-dhp-sidecar
```

The sidecar will be deployed along with the user application VM.

**Sidecar responsibilities in MVP:**

- Start inside the app.hsbc VM.
- Register with Cranker for reply URL / control channel.
- Request database credentials from PgMaker / PGaaS.
- Start local PG wire proxy.
- Listen on localhost:5432.
- Connect upstream to the real PgMaker database endpoint.

**Work items:**

- Create Rust project for `pgaas-dhp-sidecar`.
- Add configuration loading.
- Add structured logging.
- Add health endpoint.
- Add Cranker registration support.
- Add PgMaker credential request client.
- Add local PG wire proxy listener.
- Package sidecar for app.hsbc VM deployment.

**MVP output:**

```text
pgaas-dhp-sidecar can run inside the app.hsbc VM.
```

**Acceptance criteria:**

- Sidecar starts successfully.
- Sidecar logs startup information.
- Sidecar exposes health status.
- Sidecar can register with Cranker.
- Sidecar can request credentials from PgMaker / PGaaS.
- Sidecar can be deployed by app.hsbc along with application code.

---

### Milestone 5: Credential Request Flow

**Goal:**  
Allow the sidecar to request database credentials for the database created during onboarding.

For MVP, the sidecar will request credentials from PgMaker / PGaaS using the available onboarding metadata and sidecar configuration.

Example request:

```json
{
  "application_name": "sample-service",
  "namespace": "sample-namespace",
  "environment": "uat",
  "database_name": "sample_service_uat"
}
```

Example response:

```json
{
  "database_name": "sample_service_uat",
  "host": "pgmaker-endpoint.internal",
  "port": 5432,
  "username": "sample_service_app",
  "password": "temporary-or-managed-password",
  "expires_in_seconds": 900
}
```

**Work items:**

- Create PgMaker credential request API.
- Sidecar calls credential API during startup.
- Sidecar stores credentials in memory.
- Sidecar refreshes credentials before expiry.
- Add clear failure behavior if credentials cannot be fetched.
- Add logs and metrics for credential request success/failure.

**MVP output:**

```text
Sidecar can fetch credentials for the onboarded database.
```

**Acceptance criteria:**

- Sidecar can request credentials for the correct database.
- Credentials are not written to disk.
- Sidecar handles expired credentials.
- Credential failures are visible in logs.
- PgMaker can deny requests for unknown database/app combinations.

---

### Milestone 6: Local PG Wire Protocol Proxy

**Goal:**  
Run a local PostgreSQL wire protocol proxy inside the app.hsbc VM.

The application should connect locally:

```text
localhost:5432
```

The sidecar should connect upstream to the real PgMaker database using credentials fetched from PgMaker / PGaaS.

```text
Application
    ↓
localhost:5432
    ↓
pgaas-dhp-sidecar
    ↓
PgMaker database endpoint
```

**Work items:**

- Implement local TCP listener on `127.0.0.1:5432`.
- Implement PG wire proxying.
- Use fetched credentials for upstream connection.
- Handle upstream connection failures.
- Handle credential refresh.
- Add connection metrics.
- Add proxy logs with correlation IDs.
- Add graceful shutdown behavior.

**MVP output:**

```text
Application can connect to the database through localhost:5432.
```

**Acceptance criteria:**

- Application connects using `localhost:5432`.
- Sidecar successfully proxies traffic to PgMaker database.
- Application does not need direct database host or password.
- Sidecar reconnects after upstream failure.
- Sidecar exposes useful health and readiness checks.

---

## 5. MVP Timeline

### Week 1: Onboarding and PgMaker Config

**Focus:**

- app.hsbc onboarding boolean.
- PGaaS / PgMaker metadata contract.
- PgMaker config creation.
- Default database naming convention.
- API contract between app.hsbc, PGaaS, and PgMaker.

**Expected output by end of Week 1:**

```text
app.hsbc can send database required metadata to PgMaker,
and PgMaker can create a basic database config.
```

---

### Week 2: Database Provisioning and Sidecar Foundation

**Focus:**

- Default database creation.
- Basic database role creation.
- Sidecar Rust project.
- Sidecar deployment packaging.
- Cranker registration.
- Credential request API.

**Expected output by end of Week 2:**

```text
PgMaker can provision the default database,
and the sidecar can start inside the app.hsbc VM.
```

---

### Week 3: Local Proxy and End-to-End MVP

**Focus:**

- Sidecar credential fetch.
- Local PG wire proxy on localhost:5432.
- End-to-end application connectivity test.
- Logs, health checks, and basic operational visibility.
- MVP demo and handover.

**Expected output by end of Week 3:**

```text
Application deployed on app.hsbc can connect to its PgMaker database through localhost:5432.
```

---

## 6. MVP End-to-End Flow

```text
1. User onboards application to app.hsbc.

2. User selects:
      Database required = Yes

3. app.hsbc sends onboarding metadata to PGaaS.

4. PGaaS selects DHP / PgMaker.

5. PgMaker creates database config.

6. PgMaker provisions default database.

7. app.hsbc deploys application VM.

8. pgaas-dhp-sidecar starts inside the VM.

9. Sidecar registers with Cranker.

10. Sidecar requests database credentials from PgMaker / PGaaS.

11. Sidecar starts PG wire proxy on localhost:5432.

12. Application connects to localhost:5432.

13. Sidecar connects to actual PgMaker database endpoint.

14. Application uses database without knowing real DB host or credentials.
```

---

## 7. Phase 2: OIDC and Seamless IAM — 3 Months

The OIDC implementation should be treated as the larger IAM phase.

In the final model, OIDC should wrap the sidecar credential flow.

That means before the sidecar can request credentials, it must first prove its VM / workload identity using OIDC-based IAM.

Target flow:

```text
Application VM starts
        ↓
pgaas-dhp-sidecar starts
        ↓
Sidecar proves VM/workload identity
        ↓
OIDC token is issued
        ↓
Sidecar sends token to PgMaker Credential Broker
        ↓
Credential Broker validates identity and policy
        ↓
Broker returns database credential or PG18 OAuth token
        ↓
Sidecar starts local proxy
```

### Phase 2 work items

#### 7.1 VM Workload Identity

- Define app.hsbc VM identity model.
- Define how a VM proves identity to IAM.
- Decide bootstrap mechanism:
  - mTLS certificate
  - VM metadata identity
  - vTPM / TPM attestation
  - SPIFFE/SPIRE style workload identity
- Define identity claims:
  - VM ID
  - Application name
  - Namespace
  - Environment
  - Cluster
  - Region
  - Owner
  - Platform

#### 7.2 OIDC Token Issuance

- Create or integrate with OIDC issuer.
- Sidecar obtains short-lived OIDC token.
- Token audience should be PgMaker Credential Broker.
- Token should have short TTL.
- Token should not be written to disk.
- Add token renewal.

Example token claims:

```json
{
  "iss": "https://iam.app.hsbc",
  "sub": "apphsbc/prod/sample-namespace/sample-service/vm-123",
  "aud": "pgmaker-credential-broker",
  "application_name": "sample-service",
  "namespace": "sample-namespace",
  "environment": "prod",
  "cluster": "cluster-01",
  "vm_id": "vm-123",
  "exp": 1760000300
}
```

#### 7.3 PgMaker Credential Broker Authorization

- PgMaker validates OIDC token signature.
- PgMaker checks issuer.
- PgMaker checks audience.
- PgMaker checks expiry.
- PgMaker maps token identity to PgMaker config.
- PgMaker verifies whether this workload can access the requested database.
- PgMaker returns credentials only if policy allows.

Authorization rule:

```text
Workload identity + PgMaker policy = database credential
```

Not:

```text
Request says database required = database credential
```

#### 7.4 PG18 OAuth Path

For PostgreSQL 18, the long-term target is to avoid database passwords where possible.

Target model:

```text
Sidecar proves workload identity
        ↓
PgMaker Credential Broker validates policy
        ↓
Broker issues database access token
        ↓
Sidecar connects to PostgreSQL 18 using OAuth token
```

For PostgreSQL versions before 18, PgMaker can continue issuing short-lived database passwords.

---

## 8. Phase 2 Timeline — 3 Months

### Month 1: Identity Design and Bootstrap

**Focus:**

- Finalize VM identity design.
- Decide bootstrap model.
- Define OIDC issuer contract.
- Define token claims.
- Define trust relationship between app.hsbc IAM and PgMaker.

**Expected output:**

```text
Approved workload identity and OIDC design.
```

---

### Month 2: OIDC Integration with Sidecar and Broker

**Focus:**

- Sidecar obtains OIDC token.
- PgMaker broker validates OIDC token.
- Broker maps identity to PgMaker config.
- Broker authorizes database credential request.

**Expected output:**

```text
Sidecar credential request is protected by OIDC identity.
```

---

### Month 3: Hardening and PG18 Readiness

**Focus:**

- Token renewal.
- Certificate rotation if using mTLS.
- Revocation model.
- Audit logs.
- Policy enforcement.
- PG18 OAuth path design / prototype.
- Security review.
- Operational runbook.

**Expected output:**

```text
Production-ready seamless IAM model for app.hsbc + PgMaker integration.
```

---

## 9. Key Design Principles

### 9.1 Application Should Not Manage DB Credentials

The user application should not need direct DB password handling.

The application should only connect to:

```text
localhost:5432
```

The sidecar manages the actual credential and upstream database connectivity.

---

### 9.2 Sidecar Should Not Be Trusted Just Because It Runs in a VM

The sidecar must prove its workload identity.

For MVP, this may be simplified.

For the 3-month IAM phase, this should be enforced using OIDC and VM identity.

---

### 9.3 PgMaker Should Authorize Based on Metadata and Policy

PgMaker should check:

- Application name
- Namespace
- Environment
- Cluster
- VM identity
- Database mapping
- Role mapping
- Request status

PgMaker should not issue credentials only because a request says it needs a database.

---

### 9.4 Credentials Should Be Short-Lived

For MVP, if passwords are used, they should ideally be short-lived and rotated.

For PG18 and future state, OAuth token-based database access should be evaluated.

---

## 10. Post-MVP Enhancement: Repo-Driven Database Intent with `pgaas.json`

Once the sidecar and local proxy model is working, the next advanced step is to let application teams declare their database requirements directly inside their service repository.

The idea is to introduce a simple repository-level file such as:

```text
pgaas.json
```

This file would describe what the service needs from the database platform.

Instead of database configuration being managed only through a platform UI or manual request, the service repository can become the source of intent.

Example:

```json
{
  "database": {
    "required": true,
    "platform": "dhp-pgmaker",
    "name": "sample_service_uat",
    "engine": "postgres",
    "version": "17",
    "profile": "default"
  },
  "postgres_config": {
    "max_connections": 100,
    "shared_buffers": "512MB",
    "work_mem": "16MB"
  },
  "network": {
    "firewall": {
      "allowed_sources": [
        "apphsbc:namespace:sample-namespace"
      ]
    }
  },
  "vm": {
    "memory": "2GB",
    "cpu": 2,
    "disk": "30GB"
  }
}
```

The file does not need to be fully supported during MVP. It should be treated as a future capability after the basic app.hsbc onboarding, sidecar, credential request, and local proxy flow are working.

### Why this is useful

This gives application teams a clean and repeatable way to express:

- Whether they need a database.
- Which PGaaS platform they want to use.
- Basic database configuration.
- PostgreSQL configuration overrides.
- Network firewall requirements.
- VM sizing or database runtime requirements.
- Future scaling or environment-specific needs.

This also aligns with the broader app.hsbc model:

```text
Bring your code and platform intent.
app.hsbc and PGaaS handle deployment, database provisioning, resilience, and operations.
```

### Important control principle

The `pgaas.json` file should represent **requested intent**, not automatic unrestricted execution.

For example, if a service asks for a PostgreSQL config change or firewall change, PGaaS / PgMaker should still validate the request against policy.

Recommended model:

```text
Application repo contains pgaas.json
        ↓
app.hsbc deployment pipeline or sidecar reads database intent
        ↓
Request is posted to PGaaS / PgMaker
        ↓
PgMaker validates policy, ownership, environment, and allowed limits
        ↓
PgMaker provisions or updates the database configuration
```

This avoids a risky model where any repository change can directly modify production database settings without platform validation.

### Sidecar role in this model

The sidecar can support this model by posting database intent or runtime change requests to PGaaS / PgMaker.

However, the sidecar should not become an unrestricted database admin tool.

Its role should be:

- Discover local application database intent.
- Register with Cranker / platform control path.
- Report service metadata.
- Request database credentials.
- Start local PG wire proxy.
- Submit database configuration change requests when allowed.
- Report current database connectivity and health.

The actual decision should remain with PGaaS / PgMaker.

```text
Sidecar requests.
PGaaS / PgMaker validates.
PgMaker provisions.
```

### Possible change request examples

The repo-driven model can later support requests such as:

```text
Change PostgreSQL configuration
Update network firewall allowlist
Change VM database profile
Request larger DB profile
Request additional role
Request read-only database access
Request connection pool setting change
Request environment-specific database settings
```

### Example lifecycle

```text
Developer updates pgaas.json
        ↓
Code is pushed to repository
        ↓
app.hsbc pipeline detects pgaas.json
        ↓
PGaaS receives database intent
        ↓
PgMaker compares desired state vs current state
        ↓
PgMaker creates a change request or applies safe changes
        ↓
Sidecar receives updated connection/runtime config
        ↓
Application continues using localhost:5432
```

For production safety, high-risk changes should require approval or controlled rollout.

Examples:

- Firewall changes
- Large VM size increase
- Major PostgreSQL config changes
- Restart-required configuration changes
- Database version upgrades
- Storage changes

---

## 11. Future Enhancement: app.hsbc Friendly Database UI

If app.hsbc wants a more user-friendly experience later, a UI can be added on top of the same PGaaS / PgMaker APIs.

The UI would allow users to view and manage database-related settings without directly editing JSON.

Possible UI capabilities:

- View database created for the application.
- View current database endpoint and local sidecar status.
- View database configuration.
- Request PostgreSQL config changes.
- Request firewall changes.
- Request VM/database profile changes.
- View provisioning status.
- View credential/sidecar health.
- View audit history.
- Show pending approvals or rejected requests.
- Show environment-specific database configuration.

The UI should use the same backend APIs as the `pgaas.json` model.

This means app.hsbc can support both models:

```text
Developer-friendly model:
  pgaas.json in repo

User-friendly model:
  app.hsbc UI backed by PGaaS / PgMaker APIs
```

This keeps the platform flexible.

Advanced teams can manage database intent as code, while other teams can use a guided UI.

---

## 12. MVP Out of Scope

The following items are not required for the 3-week MVP:

- Full OIDC implementation
- VM attestation
- TPM / vTPM identity
- PG18 OAuth token-based database login
- Advanced role customization
- Multi-database onboarding
- Read/write split routing
- Fully automated database sizing questionnaire
- Production-grade policy engine
- Full self-service lifecycle management
- Full `pgaas.json` desired-state reconciliation
- app.hsbc database configuration UI

These should be handled in Phase 2 or later phases.

---

## 13. Risks and Considerations

| Area | Risk | Mitigation |
|---|---|---|
| Identity | MVP may not have full workload identity | Keep MVP scoped and add OIDC in Phase 2 |
| Credentials | Sidecar may temporarily handle DB password | Store in memory only and use short TTL where possible |
| Proxy | PG wire proxy may need careful protocol handling | Start with basic pass-through proxy and harden iteratively |
| Naming | Generated DB names may collide | Use deterministic naming and idempotency |
| Operations | Sidecar failure can impact app DB connectivity | Add health checks, restart policy, and clear logs |
| Security | Dummy VM should not get DB access | Enforce proper IAM in Phase 2 |
| Ownership | app.hsbc, PGaaS, and PgMaker boundaries may blur | Define clear API contracts and ownership early |
| Repo-driven config | Unsafe repo changes could trigger risky DB changes | Treat `pgaas.json` as requested intent and validate through PgMaker policy |
| UI | UI could duplicate PGaaS logic | Keep UI as a thin layer over the same PGaaS / PgMaker APIs |

---

## 14. Success Criteria

The MVP is successful if:

```text
A user can onboard an application to app.hsbc,
select that a database is required,
have PgMaker create a default database,
deploy a sidecar inside the app VM,
and connect the application to the database using localhost:5432.
```

The Phase 2 IAM implementation is successful if:

```text
The sidecar can prove VM/workload identity using OIDC,
PgMaker can authorize the workload,
and credentials are issued only to the correct application VM.
```

The post-MVP platform enhancement is successful if:

```text
Application teams can declare database intent through pgaas.json
or a future app.hsbc UI,
while PGaaS / PgMaker remains the policy and provisioning authority.
```

---

## 15. Final Target State

```text
app.hsbc becomes the application platform.
PGaaS becomes the database platform selector.
DHP / PgMaker becomes one of the supported database providers.
pgaas-dhp-sidecar becomes the local database access layer.
OIDC becomes the identity and authorization wrapper.
pgaas.json or app.hsbc UI becomes the database intent layer.
```

Final developer experience:

```text
Bring your code to app.hsbc.
Select that you need a database.
Optionally declare database intent in pgaas.json.
Deploy your app.
Connect to localhost:5432.
PgMaker and app.hsbc handle the rest.
```

Longer term, the same capability can be exposed through either:

```text
pgaas.json in the service repository
```

or:

```text
a user-friendly app.hsbc database configuration UI
```
