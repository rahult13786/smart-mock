# Mock API Portal

Two parts:

| Folder / file | What it is |
|---|---|
| `server/` | Node + Express API on **NeDB**. Register an API, then `GET` / `POST` / `PATCH` JSON records on its base path. |
| `frontend/` | React (Vite) portal: register APIs, paste a sample JSON, pick searchable tags, browse records and edit them on a generated details page. |
| `Dockerfile`, `Dockerfile.ubi`, `deploy/build-image.sh`, `openshift/` | Container images, build script and OpenShift resources (see *Deploy*) |
| `deploy/build-package.sh` (`npm run package`), `deploy/package.Dockerfile`, `deploy/make-release.sh` (`npm run release`), `deploy/release.Dockerfile`, `openshift/simple-build.yaml` | Simple OpenShift deploy: upload only the release folder (see *Deploy → OpenShift → Option 0*) |
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

**Deployable package** (tests → portal build → server with production dependencies → start-up check → archive):

```bash
npm run package                         # or: sh deploy/build-package.sh [--version 1.2.0] [--clean] [--skip-tests]
```
Everything to deploy lands in `dist/`:

| File | |
|---|---|
| `Dockerfile` | 9 lines: `FROM node:22-alpine` + `ADD mock-api-portal-<version>.tar.gz /opt/` – Docker / Podman / OpenShift unpack the archive themselves; no npm, no build, no RUN |
| `mock-api-portal-<version>.tar.gz` (+ `.sha256`) | the application: `server/` (with production dependencies), `frontend/dist/`, `samples/`, `openshift/`, `start.sh`, `DEPLOY.md`, `build-info.json` |
| `DEPLOY.md` | deployment steps |

Deploy: `oc start-build mock-api-portal --from-dir=dist --follow` (OpenShift) · `cd dist && docker build --platform linux/amd64 -t mock-api-portal .` (Docker) ·
or unpack the archive and run `./mock-api-portal/start.sh` on a server with Node.js 20.19+ / 22.

Server env vars: `PORT` (4000), `DATA_DIR` (`server/data`), `BODY_LIMIT` (`50mb`),
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) to keep the data
in Redis (see *Deploy*), `REMOTE_PREFIX`,
`SEED_APIS` (optional demo data, e.g. `agreement@v1=samples/agreement.json` – registers and seeds the API on
start if it doesn't exist; several entries separated by `;`).
Server tests: `npm test` (runs `server/test/smoke.js` against `samples/agreement.json`).

## Deploy (one project: the API server also serves the built portal)

In production there is **one** Node process: `npm run build` turns the React portal into static files
(`frontend/dist`) and the API server serves them next to `/api`, `/apis`, `/admin` and `/health`.

| Target | Cost | Is the data kept? | Good for |
|---|---|---|---|
| **Vercel – Hobby + Upstash Redis (free)** | free | **yes** – in Redis (see *Keep data on Vercel / Render free*) | free hosting with real data |
| Vercel – Hobby without Redis | free | **No** – only in `/tmp` of a function instance; lost when the instance is recycled (can be seconds) | nothing serious |
| **Render – Free + Upstash Redis** | free | **yes** – in Redis | free hosting with real data |
| Render – Free without Redis | free | **No** – lost on every restart, redeploy and after 15 min idle (the service sleeps; first request then takes ~1 min) | demos |
| Render – paid + disk | paid | yes (persistent disk) | small teams |
| **OpenShift (your cluster)** | your cluster | **yes** (PersistentVolumeClaim) | team use, offline networks |
| Docker / Podman on any server | – | yes (volume) | on-prem without OpenShift |

NeDB is a file database used by **one** process. With local files run exactly **one** instance/replica
(with Redis, several instances are fine – they share the data). On hosts without persistent storage, set `SEED_APIS=agreement@v1=samples/agreement.json` so a demo API is
re-created on every start.

### Keep data on Vercel / Render free – Upstash Redis (free)

Vercel functions (and Render's free instances) have no permanent disk: whatever the API writes is gone when
the instance is recycled – on Vercel that can happen after a few seconds without traffic, or a new instance
starts with empty storage. Set two environment variables and the API keeps its data in a Redis database
instead; the local NeDB files are then only a working copy:

* before each API request the instance checks a version counter in Redis and reloads if another instance changed something;
* the changes a request makes are written to Redis **before** its response is sent;
* each record is stored separately (registry, sample and records per API), so no request gets near Upstash's
  10 MB request limit. Upstash free plan: 250 MB data, 500K commands / month.

| Variable | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` **or** `KV_REST_API_URL` | REST URL of the database (`https://….upstash.io`) |
| `UPSTASH_REDIS_REST_TOKEN` **or** `KV_REST_API_TOKEN` | REST token (not the read-only one) |
| `REMOTE_PREFIX` (optional) | key prefix, default `mockportal:` – use different prefixes to share one database between deployments |

**Vercel (Marketplace integration – sets the variables for you)**
1. Vercel → your project → **Storage** tab → **Create Database** (or **Marketplace**) → **Upstash** → *Upstash for
   Redis* → choose the **Free** plan and a region close to your functions → **Create**.
2. **Connect** it to the project (all environments). This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   (and similar variables) to Project → Settings → Environment Variables.
3. **Redeploy** (Deployments → ⋯ → Redeploy) – environment variables only apply to new deployments.
4. Check: `https://<project>.vercel.app/health` must show `"storage":"redis …upstash.io (prefix mockportal:)"`.
   If it shows `"storage":"files /tmp/mock-api-data"`, the variables are missing in that deployment.

**Upstash console (works for Vercel, Render, anywhere)**
1. https://console.upstash.com → **Create Database** → type Redis, plan Free, a region near your host → Create.
2. On the database page, section **REST API**: copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Add both as environment variables (Vercel: Settings → Environment Variables; Render: service → Environment),
   then redeploy / restart. Check `/health` as above.

With Redis configured, `SEED_APIS` only creates the demo API when it is not in Redis yet – it no longer comes
back after you delete it, and your own changes are kept.

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
   * **Framework Preset**: *Other*. (`"framework": null` in `vercel.json` is how Vercel writes *Other*.)
   * The import form may not show the values from `vercel.json` – that is fine: Vercel applies `vercel.json`
     when it **builds each deployment**, and its `framework`, `installCommand`, `buildCommand` and
     `outputDirectory` override whatever the form / Project Settings say. **Root Directory must stay `./`**,
     otherwise the `vercel.json` in the repository root is not read.
   * **Root Directory**: `./`.
   * **Build and Output Settings**: leave them – `vercel.json` sets install `npm run install:all`, build
     `npm run build`, output `frontend/dist`.
   * **Environment Variables**: `SEED_APIS` = `agreement@v1=samples/agreement.json` (recommended, see below).
3. Click **Deploy**. When it finishes, open the `https://<project>.vercel.app` URL.
4. Project → **Settings → Build and Deployment → Node.js Version**: choose **22.x** (then redeploy).
5. **Keep the data (required for real use)**: Project → **Storage** → add **Upstash for Redis** (free) and connect
   it, then redeploy – see *Keep data on Vercel / Render free*. Without it, registered APIs and records vanish
   whenever Vercel recycles the function (often within seconds).

CLI alternative: `npm i -g vercel` → `vercel` (preview) → `vercel --prod` (production), run in the project folder.

**How to check that `vercel.json` was used** (after a deployment)
1. Deployment → **Source**: `vercel.json` is listed at the top level (next to `package.json`, `api/`, `frontend/`).
2. Deployment → **Build Logs**: the install step runs `npm run install:all` and the build step runs
   `npm run build` (you see `vite build` and `frontend/dist/...` files). With the defaults instead you would
   see a plain `npm install` and no `vite build`.
3. Deployment → **Resources / Functions**: one function, `api/index.js` (shown as `/api/index`).
4. In a terminal (replace the host):
   ```bash
   curl -s https://<project>.vercel.app/health                  # {"ok":true}            ← rewrite /health → function
   curl -s https://<project>.vercel.app/admin/apis              # JSON list of APIs      ← rewrite /admin/*
   curl -s https://<project>.vercel.app/api/agreement/v1?fields=id   # JSON records  ← rewrite /api/*
   curl -sI https://<project>.vercel.app/browse/agreement__v1 | head -1   # 200, the portal page ← SPA rewrite
   ```
   Without `vercel.json` these return Vercel's 404 page (there is no file or function at those paths).
   Any JSON answer from the API – even an API error like `FILTER_PATH_NOT_FOUND` – proves the rewrites
   in `vercel.json` are active.
5. CLI alternative: `vercel inspect <deployment-url> --logs` prints the same build log.

**If the build or the site still behaves differently from `vercel.json`**
* Project → **Settings → Build and Deployment**: Framework Preset *Other*; Install Command, Build Command and
  Output Directory either empty (then `vercel.json` decides) or exactly `npm run install:all`, `npm run build`,
  `frontend/dist`; Root Directory empty (`./`). Redeploy (Deployments → ⋯ → Redeploy, without build cache).
* The deployment's **Build Logs** should show `npm run install:all` and `vite build`; **Functions** should
  list `api/index.js`. Check `https://<project>.vercel.app/health` → `{"ok":true}`.

**Limits to know**
* **Without Redis**, data is written to `/tmp` inside a function instance. It survives only while that instance is
  alive and is not shared between instances – so it vanishes or differs between requests (APIs "disappear"
  after a few seconds). **Add Upstash Redis** (section *Keep data on Vercel / Render free*) – then the data is kept.
* Request bodies sent to a Vercel function are limited (about 4.5 MB), so very large samples or POSTs may be rejected.
* Each request can run up to 30 s (`maxDuration` in `vercel.json`).

### C. OpenShift (your local / on-prem cluster)

Files: `Dockerfile` (two-stage build on `node:22-alpine`, starts `node` directly, runs as any non-root user,
port 8080), `Dockerfile.ubi` (same on Red Hat UBI 9 / Node 22 – for clusters that only allow Red Hat images, also
IBM Power / Z), `deploy/build-image.sh` (builds for a chosen CPU architecture and checks it) and
`openshift/mock-api-portal.yaml` (ImageStream, BuildConfig, 1 Gi PersistentVolumeClaim, Deployment with
1 replica, Service, TLS Route).

Prerequisites: the `oc` CLI and a login to the cluster (`oc login https://api.<cluster>:6443 -u <user>`;
for OpenShift Local / CRC: `crc console --credentials` shows the command).

**Option 0 – simplest: keep `node:22-alpine` in the cluster, upload only the release folder (recommended)**

Nothing is installed or compiled inside the cluster and no image `.tar` is copied: on your machine
`npm run release` builds the portal and puts the server, its dependencies (pure JavaScript – they work on any
CPU) and the portal into `./release` (~11 MB). OpenShift copies that folder onto the `node:22-alpine` image it
already has (`deploy/release.Dockerfile`, 10 lines) and redeploys. The image is assembled on the cluster's own
architecture, so `exec format error` cannot happen.

*One time – resources and the base image:*
```bash
oc new-project mock-api-portal
oc apply -f openshift/mock-api-portal.yaml
oc apply -f openshift/simple-build.yaml        # BuildConfig "copy release onto node:22-alpine" + ImageStream "node"
```
The ImageStream `node:22-alpine` imports `docker.io/library/node:22-alpine` (edit the `from` in
`openshift/simple-build.yaml` to use your mirror). **Cluster without any registry access:** push the base image
once from your Mac – for the nodes' architecture:
```bash
podman pull --platform linux/amd64 docker.io/library/node:22-alpine
REG=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
podman login -u "$(oc whoami)" -p "$(oc whoami -t)" "$REG" --tls-verify=false
podman tag docker.io/library/node:22-alpine "$REG/mock-api-portal/node:22-alpine"
podman push "$REG/mock-api-portal/node:22-alpine" --tls-verify=false
# (no route to the registry? podman save -o node-22-alpine.tar … on the Mac, podman load + push on a machine that can reach it)
```
Check: `oc get istag node:22-alpine` shows the image.

*Every release (2 commands, from the project folder on your Mac):*
```bash
npm run package                                         # tests + build → dist/ (Dockerfile + .tar.gz)
oc start-build mock-api-portal --from-dir=dist --follow # uploads ~1.3 MB, builds in seconds, redeploys
```
(`npm run release` + `--from-dir=release` does the same with the unpacked folder, without tests.)
`oc rollout status deployment/mock-api-portal` waits for the new pod; data on the PVC is kept.

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

> **Build for the nodes' CPU architecture.** An image built on an Apple-Silicon Mac is `arm64`; on `x86_64`
> nodes it fails with `exec format error` (see *Troubleshooting*). Check the nodes first:
> `oc get nodes -o jsonpath='{.items[*].status.nodeInfo.architecture}{"\n"}'` → usually `amd64`.

```bash
# on a machine WITH internet (Podman or Docker) – builds linux/amd64, checks it, writes a .tar:
sh deploy/build-image.sh --arch amd64 --tag mock-api-portal:1.0 --save
#   (same as: podman build --platform linux/amd64 -t mock-api-portal:1.0 .  +  podman save …)
#   Red Hat UBI base image: add --ubi · internal mirrors: --build-arg NODE_IMAGE=… --build-arg NPM_REGISTRY=…
# copy the .tar to a machine that can reach the cluster, then:
podman load -i mock-api-portal-1.0-amd64.tar
podman image inspect --format '{{.Os}}/{{.Architecture}}' mock-api-portal:1.0   # must match the nodes

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
| New version | Option 0: `npm run package && oc start-build mock-api-portal --from-dir=dist --follow` · Option 1: `oc start-build mock-api-portal --from-repo=. --follow` · Option 2: build, push again |
| Back up the data | `POD=$(oc get pod -l app=mock-api-portal -o name)` then `oc rsync $POD:/data ./backup` |
| Restore the data | `oc rsync ./backup/data/ $POD:/data/` then `oc rollout restart deployment/mock-api-portal` |
| Bigger disk | edit the PVC size (if the storage class allows expansion) |
| Remove everything | `oc delete all,pvc,is,bc -l app=mock-api-portal` |

Keep `replicas: 1` – NeDB files must be written by one process (the Deployment uses the `Recreate` strategy
so the old pod stops before the new one mounts the volume).

### Troubleshooting OpenShift / containers

| Symptom | Cause | Fix |
|---|---|---|
| Pod `CrashLoopBackOff`, log: `exec format error` (e.g. `docker-entrypoint.sh: exec format error`, `exec /usr/local/bin/node: exec format error`) | The image was built for another CPU architecture than the node – typically built on an Apple-Silicon Mac (`arm64`) and run on `x86_64` nodes, or the other way round (also IBM Power `ppc64le` / Z `s390x`). | Compare `podman image inspect --format '{{.Architecture}}' <image>` with `oc get nodes -o jsonpath='{.items[*].status.nodeInfo.architecture}'`. Rebuild for the nodes: `sh deploy/build-image.sh --arch amd64` (or `podman build --platform linux/amd64 …` / `docker buildx build --platform linux/amd64 … --load`), push again. Or build **inside** the cluster (Option 1) – that always matches the nodes. |
| `exec format error` / `no such file or directory` for a **script** you added | Windows line endings (CRLF) in the script | `.gitattributes` keeps LF; convert with `dos2unix` or `sed -i 's/\r$//' file`. The image itself starts `node` directly (no shell script). |
| `Startup failed: EACCES … /data/…` | The data volume is not writable for the pod's random UID (e.g. data written by an old image version or another project) | `oc debug deployment/mock-api-portal --as-root` → `chmod -R g+rwX /data && chgrp -R 0 /data`, or give the pod an `fsGroup`. New files are created group-writable (`0664`). |
| `ImagePullBackOff` | Deployment can't find the image | `oc get is mock-api-portal` must show a `latest` tag; the push in Option 2 must go to `<registry>/<project>/mock-api-portal:latest`. |
| Route shows "Application is not available" | Pod not ready | `oc get pods`, `oc logs deployment/mock-api-portal`; readiness probe is `GET /health` on port 8080. |

### D. Docker / Podman on any server

```bash
docker build --platform linux/amd64 -t mock-api-portal .      # match the server's CPU architecture
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
| POST | `/api/{name}/{version}` | Object or array of objects. `id` generated when missing; `409` if the id exists. Response `201` with the **final stored record** (array for an array body) – generated ids, Create (post) values and maps included – and a `Location` header for a single record. |
| DELETE | `/api/{name}/{version}/{id}` | Deletes the record → `{"deleted": id}`; `404` if it doesn't exist. (To remove a node *inside* a record use PATCH with a JSON Patch `remove` op.) |
| PATCH | `/api/{name}/{version}/{id}` | **JSON Patch** (RFC 6902) with `Content-Type: application/json-patch+json` (or any array body); **JSON Merge Patch** (RFC 7396) with `Content-Type: application/merge-patch+json` (or any object body). `?mode=json-patch|merge` overrides. Response header `X-Patch-Mode`. A failed `test` op → `409`; invalid path → `422`; changing `id` → `400`. Response `200` with the **full updated record** as stored. |

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

### Must, Create (post), Regex and Map – new resources

These rules apply to **POST** and to **PATCH JSON Patch `op: "add"`** (a new record, a new list item or a new
node). `replace`, `remove`, Merge Patch and the raw JSON editor do not trigger them.

* **Must** (any tag) – the value is required. Missing, `null` or `""` → `422`
  `{"code": "MUST_VIOLATION", "violations": [{"path": "/agreementItem/0/stcAgreementItemBusinessId", "tag": "..."}]}`.
  Inside lists it is checked on every item; a list that is absent or empty has no items to check.
* **Create (post)** (any tag; ticked by default for the root `id`):
  * **non-id tags** – when the field is missing (or `null` / `""`) in the new resource, the server adds it at its
    path and fills a value: a random allowed value for enum tags, otherwise a value shaped like the sample's values
    (dates, numbers, text – generated offline). Values that were sent are kept. Missing parent objects are created;
    items of a list that was not sent are not invented.
  * **id tags** – the server replaces the id values of the payload with newly generated ones. Generated values follow the regex when it is enabled, otherwise they are
  shaped like the sample's value (`MSA-117198-061026` → `MSA-583921-447201`) and unique within their list
  (root ids: unique among the stored records).
* **Regex** (id tags only) – *Build regex* is generated from the sample's values with
  [regexgen](https://www.npmjs.com/package/regexgen) (digits generalised, e.g. `MSA\-\d{6}\-\d{6}`; all-UUID values
  give a UUID pattern) and values are produced from it with randexp – both run offline. When **enabled**, an id
  that is missing or empty in a new resource is generated from the regex (and, with *Create (post)*, every value
  is). **Override** uses your own regex instead of the built one. The regex is stored in the API configuration
  (`tags[].regex = {enabled, override, built, pattern}`).
* **Map** (non-id tags without enum) – the field gets the value of another field: a sibling (same object) or a
  field of any parent node, e.g. `agreementItem.productOfferingPrice.name ← agreementItem.stcAgreementItemBusinessId`
  or `stcAgreementBusinessId ← id`. For a PATCH `op: add` the parent values are read from the stored record. Stored as
  `tags[].map = {enabled, source}`. Order: ids / regex → Create (post) values (incl. enum) → Map → Must check →
  enum check.
* Copies made in the portal (*Copy record*, *Copy item*) send `?generate=false`, so they keep their data as it is
  (no ids, Create (post) values or maps).
  Any client can do the same: `POST /api/agreement/v1?generate=false`.

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
| GET / PUT | `/admin/apis/{key}/sample` | Read / save sample JSON `{sample, seed?:true}` → stores the id tags of the sample (tags you added are kept while their path still exists), seeds records (upsert by id) |
| PUT | `/admin/apis/{key}/tags` | `{tags:[{path, type?, searchable, unique?, enum?, must?, create?, regex?, remove?}]}` → new paths are validated against the sample (all-or-nothing, `422` with `code` PATH_NOT_IN_SAMPLE / NOT_A_VALUE / TYPE_MISMATCH), then saved and records re-indexed. `create` and `regex` apply to id tags only; an invalid regex → `400 INVALID_REGEX` |
| GET | `/admin/apis/{key}/tags/map?path=agreementItem.productOfferingPrice.name` | Fields that can be mapped to a non-id tag (`{candidates:[{path, type, relation: sibling/parent, sample}]}`) |
| GET | `/admin/apis/{key}/tags/regex?path=agreementItem.id` | *Build regex* for an id tag from the sample (`{built, values, examples}`); with `&pattern=` it checks a regex and returns examples |
| POST | `/admin/apis/{key}/tags/validate` | Same validation without saving |
| GET | `/admin/apis/{key}/paths` | Every value path in the sample with its type |
| GET | `/admin/apis/{key}/mocks/plan?source=sample:0` | Id fields and value fields of a template (`sample:<n>` or `record:<id>`) |
| GET | `/admin/apis/{key}/mocks/current?source=&path=&filterKey=&filterValue=` | Current value(s) of a field (optionally only in matching list items) |
| POST | `/admin/apis/{key}/mocks` | `{source, count ≤ 10, idRules:[{path, values, auto, reuse, replaceAll}], fieldRules:[{path, values, auto, reuse, filter:{key,value}}]}` |
| GET | `/admin/apis/{key}/values?path=` | Distinct values found at a path (sample + records) – used to prefill enums |
| DELETE | `/admin/apis/{key}` | Removes the API and its data file |
| GET / POST | `/admin/users` | Users (password always `******`) / create `{firstName, lastName, email, password?}` – the password is generated with Node `crypto` (16 characters) |
| GET | `/admin/users/password` | A newly generated password (shown in the *New user* form) |
| GET | `/admin/users/{id}/password` | The user's password (used by the copy icon) |
| PATCH / DELETE | `/admin/users/{id}` | Edit `{firstName, lastName, email, active}` (password cannot be changed) / delete (also removed from folders) |
| GET / POST | `/admin/folders` | Folders / create `{domain, env, team, role, technology}` → name `fixedline-dev-bau-dev-ms`, `409 FOLDER_EXISTS` when it exists |
| GET | `/admin/folders/options` | Allowed values of the 5 folder fields |
| GET / DELETE | `/admin/folders/{id}` | One folder with its users / delete the folder (users are kept) |
| PUT | `/admin/folders/{id}/users` | `{userIds:[…]}` – the folder's users (replaces the list) |

## Portal

1. **Register API** – `+` asks for name and version. After creating, a text area asks for the sample
   JSON (paste or load a file). On save the API name becomes read-only and records are seeded.
2. **Tags** – saving the sample stores only the **id paths** (`id`, `agreementItem.id`,
   `agreementItem.productOfferingPrice.id`, … at any level); every other field is added by you with **+ Add tag**.
   Columns: *Path, Level, Type, Unique, Searchable, Create (post), Must, Enum, Regex / Map*.
   **Create (post)** (every tag, ticked for the root `id`) regenerates ids, and fills other fields when they are
   missing, on POST / PATCH `op: add`;
   **Must** makes the value required on POST / PATCH `op: add`. **Regex** (id tags only) shows a grey `[x]`; it opens
   a popup with the *Build regex* (generated from the sample when the popup opens), *enable* and *override*
   (an extra field for your own regex) plus example values. *Save* stores it in the API configuration and the icon
   turns into a green `[✓]`. For other tags without an enum the same `[x]` opens the **Map** popup: the JSON paths
   of sibling fields and fields of parent nodes (no child paths) with a sample value, and *enable*; *Save* stores
   the map and the icon turns green.
   The Tags section is collapsed on load (click to expand); it re-reads the configuration when the page opens
   or the browser tab gets focus, so fields made searchable by API calls show up. The root `id` is always
   **Unique** – ticked and read-only. Nested ids (`agreementItem.id`, …) start unticked; tick them yourself when
   needed (an existing configuration is reset to unticked once when 1.7.0 starts). The **Unique** column marks a field as the key
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
   * **Raw JSON** (page header, every list heading, and the tab in every popup) shows the JSON as a tree: each
     object / list has `[>]` to expand and `[V]` to collapse its children (click the marker or the key); collapsed
     nodes show their item / key count. *Edit JSON* switches to a text editor; *Save JSON* replaces the node in
     the stored record (it must keep its kind).
   * Save sends a **JSON Patch** (diff of your edits) or **JSON Merge Patch** – pick in the save bar,
     *Preview payload* shows exactly what is sent.

5. **Admin view** (sidebar, below *Register API*) – two tabs:
   * **Users** – first name, last name, email, active and password (always `******`), all read-only in the list,
     with **Edit** (popup) and **Delete** per row and **+ New user** on top. The ⧉ icon next to the password copies
     it to the clipboard without showing it. New users get a password generated by the server (Node `crypto`);
     it cannot be edited. Emails are unique.
   * **Folders** – **+ New folder** asks for Domain (fixedline, gsm), Env (dev, st, sit), Team (bau, project),
     Role (dev, test) and Technology (ms, esb) – all required – and stores the folder as
     `fixedline-dev-bau-dev-ms`; the same combination cannot be created twice. Click a folder to see its users:
     **+ Add user** lists the other users with checkboxes and adds the selected ones; **Edit** enables the checkbox
     on each row – untick and **Save** to update the association. 🗑 deletes the folder.
   Users and folders are stored in NeDB (`DATA_DIR/admin/users.db`, `folders.db`), and in Redis when the
   Upstash variables are set. Passwords are stored as they are so they can be copied – use mock credentials only.

## Security

`npm audit` reports 0 vulnerabilities for both `server/` and `frontend/` (Vite 8, React Router 7.18).
