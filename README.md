# Mock API Portal

Two parts:

| Folder / file | What it is |
|---|---|
| `server/` | Node + Express API on **NeDB**. Register an API, then `GET` / `POST` / `PATCH` JSON records on its base path. |
| `frontend/` | React (Vite) portal: register APIs, paste a sample JSON, pick searchable tags, browse records and edit them on a generated details page. |
| `Dockerfile`, `openshift/` | Container image and OpenShift resources (see *Deploy*) |
| `deploy/render.yaml` | Render Blueprint (outside the repo root on purpose – see *Deploy → Vercel*) |
| `vercel.json`, `api/index.js` | Vercel configuration and serverless entry point |

## Run

Requires **Node 20.19+** (or 22.12+) – needed by Vite 8.

```bash
npm run install:all     # installs server + frontend
npm run dev             # API on :4000, portal on http://localhost:5173 (proxied)
```

Single-process mode (portal served by the API server):

```bash
npm run build && npm start   # http://localhost:4000
```

Server env vars: `PORT` (4000), `DATA_DIR` (`server/data`), `BODY_LIMIT` (`50mb`),
`SEED_APIS` (optional demo data, e.g. `agreement@v1=samples/agreement.json` – registers and seeds the API on
start if it doesn't exist; several entries separated by `;`).
Server tests: `npm test` (runs `server/test/smoke.js` against `samples/agreement.json`).

## Deploy (one project: the API server also serves the built portal)

In production there is **one** Node process: `npm run build` turns the React portal into static files
(`frontend/dist`) and the API server serves them next to `/api`, `/apis`, `/admin` and `/health`.

| Target | Cost | Is the data kept? | Good for |
|---|---|---|---|
| **Render – Free** | free | **No** – lost on every restart, redeploy and after 15 min idle (the service sleeps; first request then takes ~1 min) | demos, trying it out |
| Render – paid + disk | paid | yes (persistent disk) | small teams |
| **Vercel – Hobby** | free | **No** – kept in `/tmp` of a function instance only; instances are recycled and may not share data | quick demos |
| **OpenShift (your cluster)** | your cluster | **yes** (PersistentVolumeClaim) | team use, offline networks |
| Docker / Podman on any server | – | yes (volume) | on-prem without OpenShift |

NeDB is a file database used by **one** process. Run exactly **one** instance/replica.
On hosts without persistent storage, set `SEED_APIS=agreement@v1=samples/agreement.json` so a demo API is
re-created on every start.

### Step 0 – put the project in a Git repository (needed for Render and Vercel)

1. Unzip the project and open a terminal in the `lookup-portal` folder.
2. Check it runs: `npm run install:all && npm run build && npm start` → open http://localhost:4000.
3. Create an empty repository on GitHub (or GitLab / Bitbucket), e.g. `mock-api-portal`.
4. Push the code (`node_modules`, `frontend/dist` and `server/data` are already in `.gitignore`):
   ```bash
   git init
   git add .
   git commit -m "Mock API Portal"
   git branch -M main
   git remote add origin https://github.com/<you>/mock-api-portal.git
   git push -u origin main
   ```

### A. Render (free web service)

The repository contains a Blueprint, `deploy/render.yaml`, with all settings. It is not in the repository root on
purpose: Vercel reads a root `render.yaml` when importing and would use it instead of `vercel.json`.

**Option 1 – Blueprint (fewest clicks)**
1. Sign in at https://dashboard.render.com (sign up with GitHub).
2. **New → Blueprint** → connect your GitHub account → pick the `mock-api-portal` repository.
   In **Blueprint file path** enter `deploy/render.yaml` (Render looks for a root `render.yaml` by default).
3. Render reads `deploy/render.yaml` and shows one web service `mock-api-portal` (plan *Free*). Click **Apply**.
4. Wait for the build (installs both packages, builds the portal) and the first deploy – watch the **Logs** tab
   until you see `Mock API server listening`.
5. Open `https://mock-api-portal-<random>.onrender.com` (shown at the top of the service page).

**Option 2 – manual setup**
1. **New → Web Service** → connect the repository.
2. Settings:
   | Field | Value |
   |---|---|
   | Language / Runtime | Node |
   | Branch | main |
   | Root Directory | *(empty)* |
   | Build Command | `npm run install:all && npm run build` |
   | Start Command | `npm start` |
   | Instance Type | Free |
3. **Advanced → Environment Variables**: `NODE_VERSION` = `22`, and optionally
   `SEED_APIS` = `agreement@v1=samples/agreement.json`.
4. **Advanced → Health Check Path**: `/health`.
5. **Create Web Service** and wait for the deploy as above.

**After deploying**
* Test: `curl https://<your-service>.onrender.com/health` → `{"ok":true}`;
  Postman base URL: `https://<your-service>.onrender.com/api/agreement/v1`.
* Every `git push` to `main` redeploys automatically (`autoDeploy`).
* Free plan facts: sleeps after 15 min without traffic; 750 free instance hours per month; the filesystem is
  temporary, so registered APIs and records disappear on restart / redeploy / sleep.
* **Keep data**: change the plan to a paid instance (e.g. *Starter*), add a **Disk** (Service → Disks → mount
  path `/var/data`, 1 GB) and set `DATA_DIR=/var/data` (the commented block in `deploy/render.yaml` does the same).

### B. Vercel (free Hobby plan)

How it runs on Vercel: the portal (`frontend/dist`) is served from Vercel's CDN, and the whole API runs as one
serverless function, `api/index.js`. `vercel.json` sends `/api/*`, `/apis/*`, `/admin/*` and `/health` to that function
and every other path to the portal.

1. Sign in at https://vercel.com with GitHub → **Add New… → Project** → **Import** the repository.
2. On the configure screen:
   * Check that the settings are not shown as *"Inferred from `render.yaml` configuration"*. If they are, the
     repository still has a `render.yaml` in its root – it must live in `deploy/` (pull the latest code, or move
     it, commit, push and import again).
   * **Framework Preset**: *Other* (the `vercel.json` in the repo also sets this).
   * **Root Directory**: `./`.
   * **Build and Output Settings**: leave them – `vercel.json` sets install `npm run install:all`, build
     `npm run build`, output `frontend/dist`.
   * **Environment Variables**: `SEED_APIS` = `agreement@v1=samples/agreement.json` (recommended, see below).
3. Click **Deploy**. When it finishes, open the `https://<project>.vercel.app` URL.
4. Project → **Settings → Build and Deployment → Node.js Version**: choose **22.x** (then redeploy).

CLI alternative: `npm i -g vercel` → `vercel` (preview) → `vercel --prod` (production), run in the project folder.

**If the build or the site still behaves differently from `vercel.json`**
* Project → **Settings → Build and Deployment**: Framework Preset *Other*; Install Command, Build Command and
  Output Directory either empty (then `vercel.json` decides) or exactly `npm run install:all`, `npm run build`,
  `frontend/dist`; Root Directory empty (`./`). Redeploy (Deployments → ⋯ → Redeploy, without build cache).
* The deployment's **Build Logs** should show `npm run install:all` and `vite build`; **Functions** should
  list `api/index.js`. Check `https://<project>.vercel.app/health` → `{"ok":true}`.

**Limits to know**
* Data is written to `/tmp` inside a function instance. It survives only while that instance is alive and is not
  shared between instances – so it can vanish or differ between requests. `SEED_APIS` puts the demo API back
  whenever a new instance starts. Use Render-with-disk or OpenShift for data that must be kept.
* Request bodies sent to a Vercel function are limited (about 4.5 MB), so very large samples or POSTs may be rejected.
* Each request can run up to 30 s (`maxDuration` in `vercel.json`).

### C. OpenShift (your local / on-prem cluster)

Files: `Dockerfile` (two-stage build, runs as any non-root user, port 8080) and
`openshift/mock-api-portal.yaml` (ImageStream, BuildConfig, 1 Gi PersistentVolumeClaim, Deployment with
1 replica, Service, TLS Route).

Prerequisites: the `oc` CLI and a login to the cluster (`oc login https://api.<cluster>:6443 -u <user>`;
for OpenShift Local / CRC: `crc console --credentials` shows the command).

**Option 1 – build inside the cluster** (the cluster can reach Docker Hub and the npm registry, or mirrors of them)

```bash
# 1. project + all resources
oc new-project mock-api-portal
oc apply -f openshift/mock-api-portal.yaml

# 2. upload the source and build the image (run in the project folder; --from-repo sends the last git commit,
#    so node_modules is never uploaded – commit first, or use --from-dir=. on a clean copy)
oc start-build mock-api-portal --from-repo=. --follow

# 3. the new image starts the Deployment automatically
oc rollout status deployment/mock-api-portal

# 4. URL
oc get route mock-api-portal -o jsonpath='https://{.spec.host}{"\n"}'
```

Using internal mirrors instead of Docker Hub / npmjs (common on closed networks):

```bash
oc patch bc/mock-api-portal --type=merge -p '{"spec":{"strategy":{"dockerStrategy":{"buildArgs":[
  {"name":"NODE_IMAGE","value":"nexus.mycorp.local:8443/library/node:22-alpine"},
  {"name":"NPM_REGISTRY","value":"https://nexus.mycorp.local/repository/npm-proxy/"}]}}}}'
oc start-build mock-api-portal --from-repo=. --follow
```

**Option 2 – cluster without internet (build the image elsewhere, push it in)**

```bash
# on a machine WITH internet (Podman or Docker):
podman build -t mock-api-portal:1.0 .
podman save -o mock-api-portal-1.0.tar mock-api-portal:1.0
# copy the .tar to a machine that can reach the cluster, then:
podman load -i mock-api-portal-1.0.tar

oc new-project mock-api-portal
oc apply -f openshift/mock-api-portal.yaml          # the BuildConfig is simply not used in this path

# the internal registry's external route (CRC: default-route-openshift-image-registry.apps-crc.testing);
# if it doesn't exist, a cluster admin can enable it:
#   oc patch configs.imageregistry.operator.openshift.io/cluster --type merge -p '{"spec":{"defaultRoute":true}}'
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REG" --tls-verify=false
podman tag mock-api-portal:1.0 "$REG/mock-api-portal/mock-api-portal:latest"
podman push "$REG/mock-api-portal/mock-api-portal:latest" --tls-verify=false

oc rollout status deployment/mock-api-portal        # the push updates the ImageStream → automatic rollout
oc get route mock-api-portal -o jsonpath='https://{.spec.host}{"\n"}'
```

**Day-2 operations**

| Task | Command |
|---|---|
| Logs | `oc logs deployment/mock-api-portal -f` |
| Demo data on start | `oc set env deployment/mock-api-portal SEED_APIS=agreement@v1=samples/agreement.json` |
| New version | Option 1: `oc start-build mock-api-portal --from-repo=. --follow` · Option 2: build, push again |
| Back up the data | `POD=$(oc get pod -l app=mock-api-portal -o name)` then `oc rsync $POD:/app/server/data ./backup` |
| Restore the data | `oc rsync ./backup/data/ $POD:/app/server/data/` then `oc rollout restart deployment/mock-api-portal` |
| Bigger disk | edit the PVC size (if the storage class allows expansion) |
| Remove everything | `oc delete all,pvc,is,bc -l app=mock-api-portal` |

Keep `replicas: 1` – NeDB files must be written by one process (the Deployment uses the `Recreate` strategy
so the old pod stops before the new one mounts the volume).

### D. Docker / Podman on any server

```bash
docker build -t mock-api-portal .
docker run -d --name mock-api-portal -p 8080:8080 -v mock-data:/app/server/data mock-api-portal
# http://<server>:8080   (data stays in the "mock-data" volume)
```

## How the API is optimised by base path

* Every registered API has its own base path `/api/{name}/{version}` **and its own NeDB file**
  (`data/apis/{name}__{version}.db`), so a request only touches the data of its base path.
* The registry lives in memory (Map) – resolving a base path is an O(1) lookup, no DB query.
* Datastores open lazily on first request, stay cached, and are auto-compacted.
* Each record is stored as a JSON string plus a small index of its searchable fields and a
  root-level summary. List views read only the summary, so huge nested arrays are never sent
  unless the full record is requested. Keys like `@type` or keys with `.`/`$` are preserved.

## Mock data endpoints

Every data URL works with **`/api/...` or `/apis/...`** (e.g. `http://localhost:5173/apis/agreement/v1/MSA-117198-061026`
or directly `http://localhost:4000/api/agreement/v1/MSA-117198-061026`). Unknown routes always answer with JSON, never an HTML page.
The portal's own pages live under `/register` and `/browse/...`, so they never collide with API URLs.

Unregistered base path → `404 {"error":"API not registered"}` for GET, POST and PATCH.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/{name}/{version}/{id}` | One record (resource path). |
| GET | `/api/{name}/{version}?id=a,b,c` | Array of the records with those ids, in the requested order. Ids not found are listed in the `X-Not-Found-Ids` header. |
| GET | `/api/{name}/{version}?status=x&agreementType=y` | Filter on any value path of the sample (dotted, may go through lists, e.g. `characteristic.name`). **Equality** (case-insensitive); `a,b` = a **or** b; several params = **and**. Operators: `name.like=agr` (contains), `status.ne=Closed`, `status.eq=Active`. |
| GET | `/api/{name}/{version}` | All records (array). `X-Total-Count` header. Also `limit`, `skip`, `q` (any searchable field), `view=summary` → `{total, items}` with root scalar fields only. |
| POST | `/api/{name}/{version}` | Object or array of objects. `id` generated when missing; `409` if the id exists. |
| DELETE | `/api/{name}/{version}/{id}` | Deletes the record → `{"deleted": id}`; `404` if it doesn't exist. (To remove a node *inside* a record use PATCH with a JSON Patch `remove` op.) |
| PATCH | `/api/{name}/{version}/{id}` | **JSON Patch** (RFC 6902) with `Content-Type: application/json-patch+json` (or any array body); **JSON Merge Patch** (RFC 7396) with `Content-Type: application/merge-patch+json` (or any object body). `?mode=json-patch|merge` overrides. Response header `X-Patch-Mode`. A failed `test` op → `409`; invalid path → `422`; changing `id` → `400`. |

Examples:

```bash
# JSON Patch – modify values at given paths
curl -X PATCH localhost:4000/api/agreement/v1/MSA-117198-061026 \
  -H 'Content-Type: application/json-patch+json' \
  -d '[{"op":"replace","path":"/status","value":"Approved"},
       {"op":"replace","path":"/agreementItem/0/productOfferingPrice/0/price/value","value":12}]'

# JSON Merge Patch – merge objects, null removes a key
curl -X PATCH localhost:4000/api/agreement/v1/MSA-117198-061026 \
  -H 'Content-Type: application/merge-patch+json' \
  -d '{"description":"updated","agreementPeriod":{"endDateTime":"31/12/2026 23:59:59"}}'
```

### Addressing list items in PATCH paths: id → unique key → index

Every path segment that steps into a list can be an **id**, a **unique key** value or an **index** – checked
in that order:

1. **id** – the item whose `id` / `Id` / `ID` equals the segment
2. **unique key** – the item whose field marked *Unique* in the tag settings equals the segment
3. **index** – the 0-based position

```bash
# agreementItem by id, productOfferingPrice by index
curl -X PATCH localhost:4000/api/agreement/v1/MSA-117198-061026 -H 'Content-Type: application/json-patch+json' \
  -d '[{"op":"replace","path":"/agreementItem/MSA-117198-061026-1-2/productOfferingPrice/1/price/value","value":12}]'

# characteristic by its unique key "name" (characteristic.name marked Unique)
  -d '[{"op":"replace","path":"/characteristic/Contract level/value","value":"Enterprise"}]'
```

Works for every operation (`path` and `from`). For `add`, a final `-` or number is the insertion position.
The response header `X-Patch-Resolved` shows how each path was resolved, e.g.
`[{"/characteristic/Contract level/value":"/characteristic/2/value"}]`. A segment matching several items
→ `409 AMBIGUOUS_ITEM`; nothing matching → `422 ITEM_NOT_FOUND`. `?pathMode=index` turns the lookup off
(plain RFC 6902 – the portal uses this).

**Merge Patch** gets the same lookup: an object sent for a list addresses items by their keys and is merged
into them (`null` removes the item):

```json
{ "agreementItem": { "MSA-117198-061026-1-2": { "productOfferingPrice": { "0": { "priceType": "OneTime" } } } },
  "characteristic": { "Contract level": { "value": "Enterprise" } } }
```

(A plain RFC 7396 merge would replace the list with that object; sending a JSON array still replaces the list.)

### Enum (allowed values) validation

A tag can carry a list of allowed values (set in the portal, or `PUT /admin/apis/{key}/tags` with
`{"path": "agreementType", "enum": ["Standard Physical", "Standard Digital"]}`; `[]` removes it).
POST and PATCH check every value found at that path – including inside lists, e.g. `characteristic.name` –
and reject the request with `422`:

```json
{ "error": "Wrong data sent on path \"/characteristic/0/name\": \"Foo\" is not allowed for \"characteristic.name\". Allowed values: ...",
  "code": "ENUM_VIOLATION",
  "violations": [{ "path": "/characteristic/0/name", "tag": "characteristic.name", "value": "Foo", "allowed": ["..."] }] }
```

`null` / missing values are allowed. Values stored before the enum was defined are kept; a PATCH only fails
when it introduces a value that is not allowed and wasn't already stored at that path. Saving the tags reports
how many stored values are outside the new enum.

### TMF630-style query parameters

| Param | Example | |
|---|---|---|
| filter | `?lifecycleStatus=Active` | only matching records (see operators above) |
| `fields` | `?fields=id,name,description,item.id,item.status,tags` | return only these attributes; dotted paths select inside objects and inside every list item; `id` is always returned. Also works on `GET /{id}`. |
| `sort` | `?sort=-updatedAt,name` | `-` = descending; dotted paths allowed; `updatedAt` / `createdAt` fall back to the time the mock stored / last changed the record when the record has no such field |
| `offset`, `limit` | `?offset=0&limit=20` | paging (`skip` = alias of `offset`); headers `X-Total-Count` (all matches) and `X-Result-Count` (returned) |

All combine: `?status=active&fields=id,name,description,status,item.id,item.status,tags&sort=-updatedAt,name&offset=0&limit=20`

### How filters are validated

For each filter parameter the server checks the tag configuration first:

1. the path is a searchable tag → query runs;
2. the path is a tag but not searchable → it is switched to searchable, records are re-indexed once, query runs;
3. the path is not configured but exists in the sample → it is added as a searchable tag, records re-indexed, query runs;
4. the path is not in the sample → `400` with `code: FILTER_PATH_NOT_FOUND` and "did you mean" suggestions.

When 2 or 3 happens the response carries `X-Search-Config-Updated: <paths>`, and the tag shows up in the portal marked *from query*.

## Admin endpoints (used by the portal)

| Method | Path | |
|---|---|---|
| GET | `/admin/apis` | List registered APIs (with record counts) |
| POST | `/admin/apis` | `{name, version}` → registers `/api/{name}/{version}` |
| GET | `/admin/apis/{name}__{version}` | One API with its tags |
| GET / PUT | `/admin/apis/{key}/sample` | Read / save sample JSON `{sample, seed?:true}` → computes tags, seeds records (upsert by id) |
| PUT | `/admin/apis/{key}/tags` | `{tags:[{path, type?, searchable, remove?}]}` → new paths are validated against the sample (all-or-nothing, `422` with `code` PATH_NOT_IN_SAMPLE / NOT_A_VALUE / TYPE_MISMATCH), then saved and records re-indexed |
| POST | `/admin/apis/{key}/tags/validate` | Same validation without saving |
| GET | `/admin/apis/{key}/paths` | Every value path in the sample with its type |
| GET | `/admin/apis/{key}/mocks/plan?source=sample:0` | Id fields and value fields of a template (`sample:<n>` or `record:<id>`) |
| GET | `/admin/apis/{key}/mocks/current?source=&path=&filterKey=&filterValue=` | Current value(s) of a field (optionally only in matching list items) |
| POST | `/admin/apis/{key}/mocks` | `{source, count ≤ 10, idRules:[{path, values, auto, reuse, replaceAll}], fieldRules:[{path, values, auto, reuse, filter:{key,value}}]}` |
| GET | `/admin/apis/{key}/values?path=` | Distinct values found at a path (sample + records) – used to prefill enums |
| DELETE | `/admin/apis/{key}` | Removes the API and its data file |

## Portal

1. **Register API** – `+` asks for name and version. After creating, a text area asks for the sample
   JSON (paste or load a file). On save the API name becomes read-only and records are seeded.
2. **Tags** – 1st- and 2nd-level paths (arrays excluded) with a *Searchable* checkbox column.
   The Tags section is collapsed on load (click to expand); it re-reads the configuration when the page opens
   or the browser tab gets focus, so fields made searchable by API calls show up. Tags ending in `id`
   (`id`, `agreementItem.id`, …) are always **Unique** – ticked and locked. The **Unique** column marks a field as the key
   of its list items (used by PATCH paths, see above). Only fields inside a list can be unique, only one per
   list, and not when the list items already have an `id` – the id is their key. Duplicates in the data are
   reported as a warning when saving.
   The **Enum** column (also on the new-tag row) opens a popup to define allowed values: type them
   (comma-separated for several) or pick from the values already used in the data. *Save tags* stores them.
   **+ Add tag** adds your own path (with suggestions from the sample), type and searchable flag. Before it is
   added – and again on *Save tags* – it is validated against the sample. If the path is missing (or the type
   doesn't match) you get the reason, "did you mean" suggestions and two actions: **Update sample** (opens the
   sample editor) or **Create new version** (opens the register form with the next version, e.g. `v2`, and copies
   the current sample into it so you can extend it).
   **✦ Create mocks** (next to *Sample JSON*) creates up to 10 records from a template (a sample record or a
   stored record), entirely offline:
   * **Id fields** – every `id` in the payload (any level) with its current value, a *New values* box
     (comma-separated, one per mock), *Auto-generate* (a value shaped like the original, e.g.
     `MSA-117198-061026` → `MSA-583921-447201`) and *Replace all* (also replace the old id wherever it occurs
     in the payload, e.g. `stcAgreementBusinessId`, `agreementItem.id` prefixes).
   * **Reuse** (before *Auto-generate*) keeps the template's value exactly as it is – auto-generate and new
     values are switched off for that row and *Replace all* does not touch it. (Not for the record id.)
   * **Other fields** (*+ Add field*) – any value path. For a field inside a list (e.g. `characteristic.value`,
     `agreementItem.productOfferingPrice.price.value`) the **filter comes first**: choose *All items* or an item
     field and value (e.g. `name = Contract level`, or `id = 172784696`); the current value of the matching
     items is then shown and the new values / reuse / auto-generate become available. Enum fields pick an
     allowed value; dates, numbers and text are generated in the sample's format.
   * Fewer values than mocks → a confirmation that the rest will be generated. The mocks are saved to the
     API's data and appear in the record list.
3. **Sidebar tab** – each registered API gets a tab immediately. It opens a list of records showing
   `id` (read-only link), `name` and other root fields, with search inputs for the searchable tags
   and a *New record* button (POST). **⧉ Copy** on each row copies the whole record and saves it as a new
   record: you must enter a new id (default `<id>-copy`); optionally the old id is also replaced everywhere it
   appears inside the record (e.g. `stcAgreementBusinessId`, item ids). The list refreshes and highlights the copy.
   The details page has the same **Copy record** button. **🗑** deletes a record (after a confirmation) – also
   available as **Delete record** on the details page. Search boxes accept `a,b` for "any of".
4. **Details page** – built from the record's JSON (list sections start collapsed; *Expand all* / *Collapse all*;
   list positions are shown 0-based, the same as in PATCH paths, and every popup shows its JSON Patch path):
   * root scalar fields on top (`id` read-only, the rest editable, types preserved);
     root objects are links that open a popup with a key/value list – nested objects and lists
     inside the popup are links again, with a breadcrumb to go back;
   * then every root list (and root object) as a list section in JSON order – columns are the union
     of item keys, scalar cells editable inline, nested values as links, paging and a filter for
     large lists (e.g. 1,260 `productOfferingPrice` items).
   * **+ Add** on every list (on the page and inside popups) adds an item and saves it to the stored JSON
     right away (JSON Patch `add` to `/<list path>/-`). Use either the **Form** – built from the fields the
     existing items use, plus *+ Add field* for new ones – or **Paste JSON** (an object, or an array to add
     several). Before saving, the item must fill at least one of the list's common fields (fields used by
     ≥ 75% of the items, e.g. `name` or `value` for `characteristic`). New fields are allowed after a
     confirmation and appear as new columns; the new rows are highlighted. Unsaved edits elsewhere on the
     page are kept.
   * **⧉ Copy** on every list item (and *Copy item* in an item's popup) duplicates the item and inserts it right
     after the original. If the item has an `id` / `Id` key at its own root level you must enter a new value
     (unique within that list); nested ids are left as they are. Saved immediately, the copy is highlighted.
   * **🗑 Delete**: on every list item, on every section heading (removes that whole list / object from the record)
     and in every popup (removes the item or nested node shown). Confirmed first, saved immediately.
   * Fields with allowed values (enum) are drop-downs that only offer those values – in the page, the popups and
     the *+ Add* form. Stored values outside the list are shown in red as *(not allowed)*.
   * **{ } Raw JSON** on every list heading shows the JSON of just that list; edit and *Save JSON* to replace it in
     the stored record (it must stay a list). Every popup (an item opened by its number, or a nested list) has a
     **Raw JSON** tab next to *Fields* that does the same for the selected node.
   * Save sends a **JSON Patch** (diff of your edits) or **JSON Merge Patch** – pick in the save bar,
     *Preview payload* shows exactly what is sent.

## Security

`npm audit` reports 0 vulnerabilities for both `server/` and `frontend/` (Vite 8, React Router 7.18).
