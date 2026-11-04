# VPS snow API migration (operator-only, no deployment by builder)

This supersedes the Render-only deployment section in `brasy-snow-fix.md`.
No merge or Render mutation is needed. Keep the existing Render service available
as rollback. No public nginx route is installed for this new API.

## Scope and baseline

- Source branch: `fix/brasy-snow-grid`; source review is still required before execution.
- SEMAPP baseline: `/opt/semapp/releases/9ddd3482302c3a37aa464025c563ebdc04b944d7-scoped`.
- Existing `semapp.service`, its readiness implementation and absence of drop-ins
  are pinned and checked. This installer **does not replace SEMAPP code/unit**.
- New `semapp-snow.service`: DynamicUser `semapp-snow`, read-only root-owned runtime,
  `ProtectHome`, no capabilities, memory/process limits; `127.0.0.1:8096` only.
- Only `/etc/semapp/backend.env` setting `LUCERN_SNOW_LOAD_API` changes, from its
  existing Render URL to `http://127.0.0.1:8096/api/snow-load`. Every other byte,
  owner/group, mode and extended attributes are preserved. Missing/duplicate,
  continued or malformed settings fail closed. Secrets are never printed.
- Root-only evidence/backup: `/opt/semapp-snow/evidence` (0700; backup 0600).
- No database, frontend, nginx, integrations, timers or other profiles are touched.
  `semapp.service` is restarted once (readiness already built into its unit),
  so expect a brief interruption. On failed cutover it is restarted once more
  against the original env after resetting only its failed/start-limit state.

## Build and review

Run unprivileged from a clean committed worktree:

```
/usr/bin/python3 -m unittest discover -s ops/vps -v
/usr/bin/python3 ops/vps/build_packet.py
/usr/bin/python3 ops/vps/smoke_packet.py
```

The builder uses a temporary directory under the configured scratch TMPDIR,
`npm ci --ignore-scripts`, tests, compiler, production-only prune and production
security audit. The payload explicitly lists hashes/modes for every regular file;
no npm install executes as root. The Linux Node executable is copied, not linked
to home. `ldd` and actual packaged runtime execution test host compatibility.
Only npm `.bin` links are excluded; any other dependency symlink is refused.
No implicit recursive privileged copy or tar extraction occurs.

Review the full packet under `/home/falka/semapp-snow-vps-migration`, including
`migrate.py`, `bootstrap.py`, `operator.py`, `semapp-snow.service`, MANIFEST,
actual SEMAPP unit/readiness copies, tests and runtime evidence. The parent agent
must independently approve the final exact bytes before the operator proceeds.
The packet is built here, not yet independently approved or deployed.

## Operator execution

Use the **exact contents of packet `COMMAND.txt`**, which contains a literal hash
of `operator.py`, after approval. Run it as `falka` in the operator's SSH terminal.
`sudo -v` prompts only there; do not send passwords to an agent. The wrapper's
`sudo -n` then requires that the operator is permitted to execute the exact command.
If authorization fails, stop; do not use a privilege workaround.

The outer command captures and hashes wrapper bytes before executing those same
bytes. The wrapper captures bootstrap and payload via no-follow directory/file
opens and independently pinned hashes, then streams both through stdin to root.
The root launcher rehashes those captured bytes, creates exclusive root-owned
release files, rejects traversal/links/duplicate/unlisted/mismatched entries,
and executes only the resulting root-owned installer.

The installer refuses a prior migration/existing snow unit, occupied port,
changed SEMAPP baseline or unsafe env. It starts and checks the exact runtime,
then performs a real Břasy 309/2 lookup before any env cutover: cadastral code
613517, parcel CPX.91830333010, raster 7032856, sk=0.85 kPa, derived area II,
explicit source and warnings, all within 44 s (SEMAPP timeout remains 45 s).
It atomically switches one setting, restarts SEMAPP, verifies a new PID and
anonymous snow lookup HTTP 401, enables the new daemon, and records
`SNOW_MIGRATION_OK` only after readback.

## Acceptance and limitations

`runtime-smoke.json` proves a real unprivileged packaged daemon with real public
upstreams and compatibility with SEMAPP's unchanged response model. It is **not**
an authenticated production-browser calculation. After operator cutover, sign in
normally to SEMAPP, query Břasy 309/2, check positive sourced 0.85, coordinates,
map links, warnings and latency. No login bypass or synthetic auth is included.
Anonymous lookup must remain 401; schema validation alone is not end-to-end auth.

The archive is an explicitly dated, one-cell fallback for transient failures,
not live verification, a nationwide dataset or a normative snow-zone map.
Other locations can still be unavailable during public-provider outages. Requests
slower than the acceptance budget abort the migration before env cutover.
The existing Kvaň live smoke test remains a known pre-existing failure; do not
claim all live-provider tests pass. Backend production audit is now remediated
(lockfile updates plus qs override); frontend is not shipped or upgraded here.

## Rollback / interruption

Use the exact root-owned revision command recorded in packet `ROLLBACK.txt`.
It validates the private backup hash, refuses env drift, atomically restores
original bytes/metadata, resets only SEMAPP's failure counter, restarts it and
checks active state plus anonymous 401 before stopping/disabling/removing the
new snow unit/current link. Releases and root-only evidence are retained.
Render stays unchanged throughout. Rollback does not delete root-owned releases.
Do not rerun the installer over retained migration evidence: it fails closed.

SIGINT/SIGTERM during cutover triggers the same rollback. SIGKILL/power loss
cannot run a handler: use the explicit rollback command after inspecting state.
If rollback cannot restart SEMAPP or detects config drift, it leaves the new
upstream installed for investigation, reports failure, and does not invent a
successful recovery. Never print the backup or broad env in logs/chat.

Root/systemd execution and authenticated production acceptance cannot be tested
without the operator's privilege boundary. No production mutation was performed
while building this packet.
