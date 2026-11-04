# Břasy 309/2 – evidence and release handoff (2026-11-04)

## Observed failure and cause

Direct production request:

```sh
curl -fsS 'https://aplikace-zatizeni-od-snehu-api.onrender.com/api/snow-load?ku=B%C5%99asy&parcel=309%2F2'
```

Repeatedly returned HTTP 200, parcel `CPX.91830333010`, KU `613517`, WGS84
`49.829316,13.584631`, elevation 467 m, but `snowLoad.sk=null` and
`Lokální grid sněhového zatížení nenalezl buňku do 100 m`.

The CSV is NOT a nationwide grid: the tracked default file contains just two
explicit demo samples near 49.508/13.708. They cannot supply Břasy. Increasing
the radius would silently substitute unrelated demo data and is not a fix.

The primary online endpoint is intermittent: direct Node/Axios probes observed
`ECONNRESET` after 1.3–5.6 s, but also valid responses after 13.9–27.4 s;
curl also observed >25 s and 35–60 s timeouts. The existing code made only one
25 s attempt, swallowed its cause, and presented the fallback-grid miss alone.
No evidence supports a CRS/index error: the application's index formula matches
the public map's JavaScript exactly (see below).

## Sourced cell, not an invented design load

Source endpoint: <https://clima-maps.info/snehovamapa/getData.php>

```sh
curl -fsS --max-time 90 \
  'https://clima-maps.info/snehovamapa/getData.php' \
  --data 'action=getData&id=7032856&coords=49-49-46_13-35-05'
```

An actual HTTP 200 JSON response captured at server Date
`Wed, 04 Nov 2026 12:54:28 GMT`:

```json
{"sk0":"0.83","sk":"0.85","mi":"0.31","sigma":"0.20","V":"0.65","alpha":"1.53","error":""}
```

SHA256 of those exact 90 response bytes:
`1070357e11e8a7cf9e87b1504a4d4dac8e31b091e10541bb0ae17fd4fd0cebe5`.
The same data was independently returned several times during investigation.
`backend/data/snow-map-cells.json` preserves the request, raw response, retrieval
time and URL. It is a **frozen, explicitly labelled one-cell archive**, not a
claim of a complete official dataset, a live response, or a normative zone map.

Index reference:
<https://clima-maps.info/snehovamapa/js/common-03062011.js>
(`getMapIndexlat`, `indexParam`). Captured JS SHA256:
`45860e48a3073902e75155de7ed074b8f32580045f29d194fd72409b753ff307`.
The public map uses WGS84 degrees, rows=2307, columns=6228,
xll=11.9284707974, yll=48.4784934355, cellsize=0.0011467188;
`(2307-floor((lat-yll)/cellsize)-1)*6228+floor((lon-xll)/cellsize)`
returns **7032856**. The physical 100 × 100 m description must not be confused
with a metric-CRS array: use the published geographic raster indexing, unchanged.
No interpolation, nearest-neighbour radius increase, elevation adjustment,
rounding of the returned sk, or substitution of `sk0` for `sk` is performed.

Methodology and limitations:
<https://clima-maps.info/snehovamapa/pdf/snehovamapa.pdf>.
It describes MWLR estimates per cell using 1961–2009 observations; values below
0.7 kN/m² require the documented design minimum. This change does not certify
compliance with today's standard. Existing engineering-verification warning and
snow-area classification are unchanged; the latter is NOT an independently
retrieved normative-zone designation.

## Implementation and verification

- Up to three retries only for transient connection/timeout/502–504 failures,
  sharing a 35 s deadline rather than three independent 35 s waits.
- Prefer a successful live result. On transient outage or explicitly disabled
  online access, allow the archived response only for the exact same map cell.
  Source includes original failure, cell ID, retrieval timestamp and explicit
  `nikoli živé ověření`. Neighbouring cells remain unavailable.
- No archived substitution for authoritative HTTP 4xx, a semantic map error,
  or an invalid successful payload. Empty/zero/negative/nonfinite sk is rejected.
- Existing CSV fallback remains unchanged; this is not a nationwide outage fix.

TDD: reset regression first failed `null !== 0.85`; offline-cell regression
first failed `null !== 0.85`; invalid-value regression first failed `0 !== null`,
and then exposed inappropriate archive substitution (`0.85 !== null`). Each was
made green with its scoped change.

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm test --prefix backend       # 4 deterministic tests passed
npm run build                  # backend + frontend passed
npm test --prefix frontend      # 2 tests passed
npm run test:api                # STILL FAILS: pre-existing Kvaň smoke lookup
```

The existing live-dependent `test:api` failed on pristine main before this fix
with the same missing-snow-value exception. Do not describe all tests as green.
Package audits also report pre-existing dependencies with vulnerabilities:
backend 7 (including 1 critical), frontend 7 (including 2 critical); dependency
upgrades are outside this scoped change.

Actual loopback HTTP route verification with real ČÚZK/elevation calls returned
HTTP 200 in 35.516 s, the same parcel/coordinates, `sk=0.85`, and the archive
provenance above. This is **local verification only**. The public Render API was
queried again afterwards and still returned null. No production deployment was
performed.

## Deployment path / approval gate

`render.yaml` identifies Node 22 Render Web Service
`aplikace-zatizeni-od-snehu-api`, rootDir `backend`, build
`npm ci && npm run build`, start `npm run start`, with online adapters enabled.
The data archive must ship alongside backend code (Render's backend root includes
`data/`). GitHub Pages workflow deploys only the frontend and does NOT deploy this
backend. No SEMAPP/auth changes are needed.

Render service ID, deployed SHA and auto-deploy branch were not discoverable
from repo metadata. No Render-related environment keys, Render CLI, repository
secrets/variables, repository webhooks, or Render commit statuses were present
in the inspected session. GitHub deployments/checks only identified Pages.
Do not invent a Render service ID or assume GitHub push deploys the backend.

**STOP for parent review of this exact commit before any push/merge/deployment.**
No external deployment was authorized in this delegated task. After approval,
use authenticated Render dashboard/API to establish the actual service ID and
branch, then deploy the reviewed backend commit. If connected auto-deploy is
main, merging would itself be deployment and also requires approval.

After deployment, require a direct public request above to return the correct
parcel/coordinates and sourced positive `snowLoad.sk`. Verify source explicitly
reports archive vs live and that the SEMAPP authenticated lookup still accepts
it. Capture Render deploy ID and deployed commit SHA. Retain rollback to the
previous deployed SHA. The 35 s snow-only wait plus cadastral/elevation latency
can approach SEMAPP's 45 s proxy timeout: verify actual latency before release;
this patch does not change proxy timeouts or unrelated lookup concurrency.

The dirty original checkout `/home/falka/aplikace-zatizeni-od-snehu` and the dirty
SEMAPP portal checkout were not modified. Work is isolated at
`/home/falka/worktrees/snow-brasy`, branch `fix/brasy-snow-grid`, based on
`2f7190389b9116a52b60c93ca97ada4e6c74a855`.
