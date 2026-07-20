# The Hosts Are Talking: Host Profile Is Now Live in Production

For a long time, understanding the real condition of a Linux host meant jumping between terminals, running multiple commands, checking dashboards, comparing timestamps, and trying to piece everything together.

CPU might look healthy while storage was overloaded. Memory might appear available while swap activity was quietly increasing. A host could look “online” while one process was consuming most of its resources.

That changes with the new **Host Profile Agent and Host Profile Dashboard**, now built and deployed in production.

Host Profile gives us a live, transparent view of what is happening across our infrastructure—from one place, in near real time.

## From a black box to a glass box

Every host now runs a lightweight **Host Profile Agent**, written in Rust.

The agent continuously collects and organizes information including:

* CPU, memory and swap usage
* System load and disk I/O
* Filesystems, mounts and storage capacity
* LVM volumes and volume groups
* Disk types, vendors and device information
* Firewall configuration
* Running processes and top resource consumers
* Static hardware and operating-system details
* KVM and database workload information

Instead of running expensive commands whenever someone opens a dashboard, the agent collects information once, stores the latest result in a small local cache and reuses that data for both APIs and realtime delivery.

This keeps the agent fast, predictable and lightweight—even when the host itself is under pressure.

## Live data without constant polling

Traditional monitoring platforms often ask every server for information repeatedly:

```text
Aggregator → Host 1
Aggregator → Host 2
Aggregator → Host 3
...again and again
```

Host Profile works differently.

Each agent maintains a persistent **gRPC connection** with the Host Profile aggregator. As new information becomes available, the agent streams it directly to the platform.

```text
Linux Host
   ↓
Host Profile Agent
   ↓ gRPC realtime stream
Host Profile Aggregator
   ↓ live updates
Host Profile Dashboard
```

There is no repeated HTTP handshake for every CPU, memory or disk request. One live connection carries compact, structured updates efficiently.

The Node.js Host Profile aggregator combines information from all connected hosts into a global view. Every aggregator can maintain the latest information for hosts across UK, HK and US, allowing the dashboard to provide a consistent infrastructure picture from any region.

## Sampling that adapts when it matters

Not every metric needs to be collected at the same frequency.

CPU, memory and I/O can change quickly. Hardware details, LVM configuration and mount information usually change much less often.

The Host Profile Agent therefore supports configurable sampling for each category.

During normal operation, metrics can be collected at a balanced interval. When a host begins experiencing heavy CPU, memory or I/O pressure, the aggregator can dynamically ask the agent to collect important information more frequently.

For example:

```text
Normal mode:
CPU and memory every 10 seconds
Top processes every 30 seconds
LVM information every 5 minutes

Investigation mode:
CPU, memory and I/O every 2 seconds
Top processes every 5 seconds
```

Sampling changes are delivered over the same gRPC connection and applied without restarting the agent.

This allows Host Profile to stay lightweight during normal operation while becoming more detailed exactly when deeper visibility is needed.

## One collection layer, multiple ways to consume it

Although gRPC powers realtime streaming, the agent also provides clearly categorized HTTP endpoints.

Developers and support teams can retrieve individual sections such as:

```text
/cpu
/memory
/swap
/disk
/io
/lvm
/mounts
/firewall
/top
/static
/snapshot
/health
```

JSON is the default response format, making the data easy to consume from applications, automation and diagnostic tooling. Plain-text output is also available when a quick terminal-friendly view is more useful.

Both HTTP and gRPC use the same internal cache. Opening an endpoint does not trigger another expensive collection cycle.

## Configuration stays simple

The agent is designed as a small, self-contained service.

Its deployment configuration contains only the information it needs to operate, such as:

* Host and region identity
* Fixed HTTP service port
* Aggregator gRPC addresses
* Default collection intervals
* Command timeouts
* Cache limits
* Enabled collectors

Runtime sampling instructions are received from the aggregator and maintained by the agent without requiring configuration-file changes or service restarts.

Collectors are separated by category in the codebase—CPU, memory, disks, LVM, mounts, processes and other system areas. This makes future additions straightforward: a new command or Linux data source can be added to the appropriate collector without changing the entire service.

## The dashboard is alive

The Host Profile dashboard is no longer showing disconnected snapshots.

As new data reaches the aggregator, updates are streamed to the user interface. CPU, memory, swap, I/O load, LVM, firewall, mounts and process information refresh continuously.

This gives teams a living view of infrastructure health:

* Which hosts have the most remaining capacity?
* Which hosts are becoming overloaded?
* Is the pressure coming from CPU, memory or storage?
* Which processes are responsible?
* How many KVM databases are running on the host?
* Is the problem temporary, or is capacity steadily declining?

Instead of reacting after a failure, we can see pressure developing and act earlier.

## Observability with transparency

Host Profile is more than another monitoring screen.

It creates a transparent path from the Linux host all the way to the dashboard:

```text
System source
→ categorized collector
→ bounded local cache
→ gRPC stream
→ regional aggregator
→ global host state
→ live dashboard
```

Every stage is observable.

We can see when the agent last collected a metric, when the aggregator received it, whether the data is fresh or stale, how frequently it is being sampled and whether any collector encountered a permission or command issue.

This is especially important during incidents. Missing information is clearly reported instead of silently producing an empty or misleading dashboard.

## Built for production, ready to grow

The first production release already gives us a powerful, centralized view of host capacity and workload behaviour.

It also creates a strong foundation for what comes next:

* Smarter capacity ranking
* Host-pressure scoring
* KVM placement recommendations
* Rebuild and role-swap projections
* Automated incident sampling
* Earlier detection of storage and memory contention
* Better capacity forecasting across regions

The most exciting part is simple: our infrastructure is no longer silent.

Every host can now explain what it is doing, how much capacity it has left, where pressure is building and which workloads are responsible.

**Host Profile turns infrastructure data into live operational understanding—and that visibility is now running in production.**
