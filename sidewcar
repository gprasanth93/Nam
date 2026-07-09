# PgMaker’s Cloud-Like SQL Proxy: Database Access, Simplified

What if an application could connect to a database as easily as connecting to `localhost`?

No manual database credentials.
No waiting days for provisioning.
No complex connection details inside application code.
No repeated back-and-forth between app teams and database teams.

That is the idea behind our new **in-house cloud-like SQL proxy pattern** for PgMaker/PGaaS.

This is our first step toward giving internal teams a modern, cloud-style database experience, while still keeping the control, security, and governance we need.

---

## The Big Idea

Today, many application teams spend time thinking about things that should ideally be invisible:

* Which database host should I connect to?
* What username and password should I use?
* Has the database been created yet?
* Where do I store the credentials?
* What happens when credentials rotate?
* How do I handle failover?

With the new PgMaker SQL proxy model, the application simply connects to a local endpoint:

```text
localhost:5432
```

Behind that simple connection, a sidecar takes care of the database complexity.

To the application, the database feels local.
In reality, PgMaker is provisioning, securing, routing, and managing the database behind the scenes.

---

## Meet the PgMaker Sidecar

Every service VM can run a lightweight **PGaaS sidecar** next to the application.

The sidecar is responsible for:

* Discovering which application it belongs to.
* Requesting database access from PGaaS.
* Receiving database connection details securely.
* Running a local PostgreSQL proxy on `localhost`.
* Connecting to the actual PgMaker database on behalf of the app.

The application does not need to know the real database hostname, port, username, or password.

It only connects to:

```text
localhost:5432
```

That is the “localhost illusion.”

---

## What Happens When a Service Starts?

When a service VM starts, the sidecar sends a request to:

```text
pgaas-creds.{env}.digital.hsbc
```

The sidecar does not need to know the database name.

It only sends application identity details such as:

* Git repository ID
* EIM ID
* Optional Git repository name
* Sidecar details
* Reply URL
* Later, workload identity/OIDC token

The important thing is this:

> The sidecar asks for database access. It does not decide the database.

That decision belongs to PGaaS/PgMaker.

---

## The New Front Door: `pgaas-access-broker`

The new service, `pgaas-access-broker`, sits in front of PgMaker and PGaaS config.

Its job is not to generate credentials.

Its job is to safely orchestrate the request.

It does four main things:

1. **Validate the request**
   Later, this will include OIDC/workload identity checks.

2. **Resolve the database mapping**
   It asks `pgaas-config`:
   “For this Git repo ID and EIM ID, which database should this app use?”

3. **Create the database if needed**
   If no database exists yet, PgMaker provisions one automatically.

4. **Forward the credential request to PgMaker**
   PgMaker then sends credentials directly to the sidecar reply URL.

This means `pgaas-access-broker` never needs to handle or store the actual database password.

---

## Where Is the Configuration Stored?

Database mapping and configuration live in **`pgaas-config`**.

This is where we keep the relationship between:

```text
Git repo ID + EIM ID + environment
        ↓
PgMaker database name
```

If the application sends no custom configuration, PGaaS creates a default database config.

If the application sends PostgreSQL or VM configuration, for example CPU, memory, disk, Postgres version, or parameters, `pgaas-config` owns that configuration flow.

The database name is generated once and kept stable.

For example:

```text
pg_payment_service_uat_a8f31c2d
```

This keeps names readable for humans while still guaranteeing uniqueness.

Even if the Git repository name changes later, the database mapping remains stable because the Git repo ID and EIM ID are the source of truth.

---

## What About Multiple Service VMs?

This is where the design becomes powerful.

Imagine 20 service VMs start at the same time and all ask for database credentials.

Without control, that could create 20 duplicate requests, 20 config checks, and 20 database creation attempts.

Instead, `pgaas-access-broker` uses a **per-repo queue**.

For the same Git repo ID, EIM ID, environment, and database key:

* The first request starts the workflow.
* The remaining requests wait in a queue.
* The database config is created only once.
* The database creation request is sent only once.
* Once the database is ready, each waiting request is forwarded to PgMaker.
* PgMaker sends credentials directly to each sidecar.

This keeps PgMaker protected from request storms and avoids duplicate database creation.

---

## Fast Provisioning

If a database already exists, credentials can be requested quickly.

If the database does not exist, PgMaker creates it automatically.

The goal is simple:

> A service should be able to get a working PostgreSQL database within a few minutes — ideally within 5 minutes.

This gives teams a cloud-like experience without leaving our internal platform.

---

## Why This Matters

For application teams, this means:

* Less database setup work.
* No hardcoded database credentials.
* Faster onboarding.
* Fewer environment-specific connection details.
* More time spent building business features.

For platform teams, this means:

* Centralized control.
* Safer credential handling.
* Better auditability.
* Standardized database provisioning.
* A path toward workload identity and OIDC-based access.

For PgMaker, this becomes a major step forward:

> PgMaker is no longer just a database provisioning platform.
> It becomes a developer-friendly database access platform.

---

## The Future: OIDC and Workload Identity

Today, the sidecar can send Git repo ID and EIM ID.

Later, the same flow can become stronger with OIDC/workload identity.

The sidecar will send a signed identity token proving:

```text
I am this workload.
I belong to this application.
I am allowed to request database access.
```

`pgaas-access-broker` will validate that identity before forwarding anything to PgMaker.

This gives us a clean future path:

```text
Application workload
        ↓
Sidecar
        ↓
pgaas-access-broker
        ↓
pgaas-config
        ↓
PgMaker
        ↓
Database credentials delivered securely
```

---

## The Simple Developer Experience

From the developer’s point of view, the experience becomes beautifully simple:

```text
My app connects to localhost:5432.
The platform handles the rest.
```

No manual hostnames.
No password files.
No waiting for hand-created databases.
No database complexity leaking into application code.

That is the power of this new PgMaker SQL proxy pattern.

It gives our developers a cloud-like PostgreSQL experience, while keeping the reliability, security, and control of our internal platform.

This is a big step toward making database access faster, safer, and much easier for everyone.
