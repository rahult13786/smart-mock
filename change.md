# Change log – Mock API Portal package

Each section lists the files inside `mock-api-portal-<version>.tar.gz` (top folder `mock-api-portal/`) that
changed compared with the previous package. `node_modules` is summarised by package.

## Modification in round 9

Package **mock-api-portal-1.9.0.tar.gz**, compared with **mock-api-portal-1.8.0.tar.gz**.

### Changes in this round

1. Data API responses return the final payload:
   * **POST** – after the record is created, it is read back from the database and returned with `201`: the final
     stored record including generated ids, regex values, Create (post) values and maps (an array for an array
     body). A single record also gets a `Location` header (`/api/{name}/{version}/{id}`).
   * **PATCH** (JSON Patch and Merge Patch) – after the update, the full updated record is read back from the
     database and returned with `200`.

### Added

None.

### Modified

| File | Why |
|---|---|
| `server/src/index.js` | POST / PATCH return the record as stored (read back after the write); `Location` header on POST |
| `server/package.json` | version 1.9.0 |
| `server/package-lock.json` | version 1.9.0 |
| `DEPLOY.md` | version 1.9.0 |
| `build-info.json` | version 1.9.0, build time |
| `change.md` | this section |

### Removed

None.

### Unchanged

`frontend/dist/*` (portal not changed), `start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/src/{accounts,generate,store,remote,tags,patch,enums,mockgen,query}.js`, `server/node_modules`.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.9.0.tar.gz` |
| `DEPLOY.md` | version 1.9.0 |
| `mock-api-portal-1.9.0.tar.gz.sha256` | new checksum |
| `change.md` | round 9 section added |

## Modification in round 8

Package **mock-api-portal-1.8.0.tar.gz**, compared with **mock-api-portal-1.7.0.tar.gz**.

### Changes in this round

1. Tags – *Create (post)* is available for every tag. On POST / PATCH `op: add`, a non-id field that is
   missing in the new resource or sub-resource is added at its path and filled: a random allowed value for enum
   tags, otherwise random data shaped like the sample (offline). Id tags keep their behaviour (new id).
2. Column *Regex* renamed to *Regex / Map*. Id tags keep the regex popup; every other tag without an enum gets the
   `[x]` icon that opens a **Map** popup listing the JSON paths of sibling fields and fields of parent nodes (no
   child paths) plus *enable*. The map is stored in the API configuration (`tags[].map = {enabled, source}`) and
   applied on POST / PATCH `op: add` after ids, regex and Create (post) / enum values: the tag gets the value of
   the mapped field. Portal copies (`?generate=false`) are left unchanged.

### Added

| File | Why |
|---|---|
| `frontend/dist/assets/index-DYpTR2x8.js` | rebuilt portal (replaces `index-BdpL4wkV.js`) |
| `frontend/dist/assets/index-E-mO4X7X.css` | rebuilt portal styles (replaces `index-7iiXUto3.css`) |

### Modified

| File | Why |
|---|---|
| `server/src/generate.js` | Create (post) for non-id tags (fill missing values, random enum value), map candidates, map application |
| `server/src/index.js` | `GET /admin/apis/{key}/tags/map`; `create` on every tag and `map` in `PUT /tags`; POST / PATCH `op: add` run ids → fill → map → must |
| `server/package.json` | version 1.8.0 |
| `server/package-lock.json` | version 1.8.0 |
| `frontend/dist/index.html` | references the rebuilt assets |
| `DEPLOY.md` | version 1.8.0 |
| `build-info.json` | version 1.8.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-BdpL4wkV.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-7iiXUto3.css` | replaced by the rebuilt portal |

### Unchanged

`start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/src/{accounts,store,remote,tags,patch,enums,mockgen,query}.js`, `server/node_modules` (no new packages).

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.8.0.tar.gz` |
| `DEPLOY.md` | version 1.8.0 |
| `mock-api-portal-1.8.0.tar.gz.sha256` | new checksum |
| `change.md` | round 8 section added |

## Modification in round 7

Package **mock-api-portal-1.7.0.tar.gz**, compared with **mock-api-portal-1.6.0.tar.gz**.

### Changes in this round

1. Tags – *Unique* is read-only (always ticked) only for the root `id`. Nested id paths are editable and start
   unticked; existing configurations are reset to unticked once on start-up.
2. Id first – the `id` column is the first column of the record list and of every list on the details page
   (right after `#`), and the first field of the details form, popups and the *+ Add* form.
3. Admin view (sidebar) with two tabs:
   * **Users** – list (first name, last name, email, active, password `******` + copy icon), *+ New user*
     (password generated with Node `crypto`, read-only), *Edit* popup, *Delete*. Stored in NeDB.
   * **Folders** – *+ New folder* (Domain, Env, Team, Role, Technology – all required) stored as a unique name
     such as `fixedline-dev-bau-dev-ms`; selecting a folder shows its users, *+ Add user* (checkbox list) and
     *Edit* (checkbox per row) + *Save* update the folder–user association in NeDB.

### Added

| File | Why |
|---|---|
| `server/src/accounts.js` | Admin view API: users, password generation (crypto), folders, folder–user association |
| `frontend/dist/assets/index-BdpL4wkV.js` | rebuilt portal (replaces `index-CWe691FI.js`) |
| `frontend/dist/assets/index-7iiXUto3.css` | rebuilt portal styles (replaces `index-D8-3jKx5.css`) |

### Modified

| File | Why |
|---|---|
| `server/src/index.js` | mounts the users / folders routes; unique rules for nested ids |
| `server/src/tags.js` | only the root `id` is forced unique |
| `server/src/store.js` | NeDB collections `admin/users.db`, `admin/folders.db` (+ Redis sync); one-time reset of nested id *Unique* |
| `server/src/remote.js` | Redis key for the admin collections |
| `server/package.json` | version 1.7.0 |
| `server/package-lock.json` | version 1.7.0 |
| `frontend/dist/index.html` | references the rebuilt assets |
| `DEPLOY.md` | version 1.7.0 |
| `build-info.json` | version 1.7.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-CWe691FI.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-D8-3jKx5.css` | replaced by the rebuilt portal |

### Unchanged

`start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`, `server/src/{generate,patch,enums,mockgen,query}.js`,
`server/node_modules` (no new packages).

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.7.0.tar.gz` |
| `DEPLOY.md` | version 1.7.0 |
| `mock-api-portal-1.7.0.tar.gz.sha256` | new checksum |
| `change.md` | round 7 section added |

## Modification in round 6

Package **mock-api-portal-1.6.0.tar.gz**, compared with **mock-api-portal-1.0.0.tar.gz**.

### Changes in this round

1. Comments removed from all source code (server, portal, scripts, Dockerfiles, OpenShift files).
2. Raw JSON is shown as a tree: `[>]` expands a node, `[V]` collapses it (record header, list headings, popup tab).
3. Saving the sample stores only the id tags; other tags are added by the user. New tag columns:
   *Create (post)* (id tags; root `id` ticked by default – ids are regenerated on POST / PATCH `op: add`) and
   *Regex* (id tags; grey `[x]` → popup with Build regex (regexgen, offline), enable, override + manual regex;
   green `[✓]` when enabled; used to generate ids of new resources / sub-resources, not for copies made in the portal).
4. New tag column *Must*: value required on POST / PATCH `op: add`.

### Added

| File | Why |
|---|---|
| `change.md` | this file |
| `server/src/generate.js` | Build regex (regexgen), id generation (regex / sample shape), Must validation |
| `frontend/dist/assets/index-CWe691FI.js` | rebuilt portal (replaces `index-BCiL5Ge-.js`) |
| `frontend/dist/assets/index-D8-3jKx5.css` | rebuilt portal styles (replaces `index-DD8tHrfZ.css`) |
| `server/node_modules/regexgen` (1.3.0) + `jsesc` 2.5.2, `regenerate` 1.5.0 | Build regex |
| `server/node_modules/randexp` (0.5.3) + `drange` 1.1.1, `ret` 0.2.2 | values from a regex |

### Modified

| File | Why |
|---|---|
| `server/src/index.js` | POST / PATCH `op: add`: Create (post), Regex, Must; `GET /admin/apis/{key}/tags/regex`; tag fields `create`, `must`, `regex`; `?generate=false`; comments removed |
| `server/src/tags.js` | sample save stores id tags only; comments removed |
| `server/src/patch.js` | hook for `op: add` values; comments removed |
| `server/src/enums.js` | comments removed |
| `server/src/mockgen.js` | comments removed |
| `server/src/query.js` | comments removed |
| `server/src/remote.js` | comments removed |
| `server/src/store.js` | comments removed |
| `server/package.json` | version 1.6.0, dependencies `regexgen`, `randexp` |
| `server/package-lock.json` | new dependencies |
| `frontend/dist/index.html` | references the rebuilt assets |
| `openshift/mock-api-portal.yaml` | comments removed |
| `openshift/simple-build.yaml` | comments removed |
| `start.sh` | comments removed |
| `DEPLOY.md` | version 1.6.0 |
| `build-info.json` | version 1.6.0, build time |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-BCiL5Ge-.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-DD8tHrfZ.css` | replaced by the rebuilt portal |

### Unchanged

`samples/agreement.json`, `server/data/`, all other `server/node_modules` packages.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | comments removed, `PACKAGE` points to `mock-api-portal-1.6.0.tar.gz` |
| `DEPLOY.md` | version 1.6.0 |
| `mock-api-portal-1.6.0.tar.gz.sha256` | new checksum |
| `change.md` | new |
