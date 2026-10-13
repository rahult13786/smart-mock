# Change log – Mock API Portal package

Each section lists the files inside `mock-api-portal-<version>.tar.gz` (top folder `mock-api-portal/`) that
changed compared with the previous package. `node_modules` is summarised by package.

## Modification in round 13

Package **mock-api-portal-1.13.0.tar.gz**, compared with **mock-api-portal-1.12.0.tar.gz**.

### Changes in this round

1. **Fix – records of an API whose sample has no `id` can be deleted.** Such records always get an id now: sample
   records get a stable id when the sample is saved (re-saving the sample no longer creates duplicates), *Create
   mocks* gives every mock a record id, and records already stored without an id are repaired when the API is
   opened (their stored key becomes their `id`).
2. **Fix – Create mocks popup.**
   * The popup body scrolls, and *Other fields* scrolls on its own with a fixed header.
   * *+ Add field* scrolls to the new row and focuses it. It stays disabled, with the reason shown, until the
     current field is complete (path, filter, and values / Reuse / Auto-generate).
   * The *Current value* of a field is shown again: it did not load since the login was added.
   * *Id fields* can be collapsed and expanded with **+** / **−**.
3. **Fix – Analytics counts only external calls.** Calls the portal makes itself carry the header
   `X-Mock-Portal: 1` and are no longer counted; calls from Postman and other systems are counted.
4. **API settings** – *# Records* is renamed **Max Records** and moved to a second line of the API form, together
   with a new **Array patch (sync)** checkbox (saved with *Save*).
5. **PATCH enhancements.**
   * `PATCH /api/{base}/{name}/{version}` without an id in the URL takes a list of records with their ids. Each
     record is merged into the stored one (fields not sent stay) and the full records come back as a list.
     All-or-nothing: an unknown id gives `404`.
   * Arrays in merge patches: with **Array patch (sync)** on, the stored array is replaced by the array sent.
     With it off, items are merged by the list's *Unique* key (matching items updated, the others added); without
     a unique key all items sent are added. Added items get the Create (post), regex, Map and Must rules. This
     applies to `PATCH …/{id}` and to the several-records PATCH.
6. **User manual** – `USER_MANUAL.md` (in the package, next to the `.tar` and in the portal under *User manual*)
   explains Max Records, Array patch (sync), every tag setting (Unique, Searchable, Create (post), Must, Enum,
   Regex / Map) and every Create mocks setting (template, number of mocks, new values, Reuse, Auto generate,
   Replace all, Filter).

### Added

| File | Why |
|---|---|
| `USER_MANUAL.md` | user manual |
| `frontend/dist/assets/index-CN30uRnL.js` | rebuilt portal: API settings line, Create mocks fixes, User manual page (replaces `index--Z-SV9Bp.js`) |
| `frontend/dist/assets/index-BUzK7hSP.css` | rebuilt portal styles (replaces `index-B9nhcY2p.css`) |

### Modified

| File | Why |
|---|---|
| `server/src/patch.js` | merge patch arrays: Array patch (sync) replace, merge by unique key, append without key |
| `server/src/index.js` | PATCH of several records, shared patch logic, `arraySync` setting, sample records get stable ids |
| `server/src/store.js` | every record gets an id, repair of records stored without one, `arraySync` default |
| `server/src/mockgen.js` | mocks of a template without an id get a record id |
| `server/src/analytics.js` | portal calls (`X-Mock-Portal: 1`) are not counted |
| `server/package.json` | version 1.13.0 |
| `server/package-lock.json` | version 1.13.0 |
| `frontend/dist/index.html` | references the rebuilt assets |
| `DEPLOY.md` | version 1.13.0 |
| `build-info.json` | version 1.13.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index--Z-SV9Bp.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-B9nhcY2p.css` | replaced by the rebuilt portal |

### Unchanged

`start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/src/{accounts,generate,remote,tags,enums,query}.js`, `server/node_modules` (no new server packages; the
portal uses `marked` for the manual page, bundled into the portal files).

### Upgrade notes

* *Array patch (sync)* is off for all existing APIs. Merge patches that send an array for a list **without** a unique
  key now add the items instead of replacing the list. Turn *Array patch (sync)* on for APIs that should keep
  replacing arrays.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.13.0.tar.gz` |
| `DEPLOY.md` | version 1.13.0 |
| `USER_MANUAL.md` | new |
| `mock-api-portal-1.13.0.tar.gz.sha256` | new checksum |
| `change.md` | round 13 section added |

## Modification in round 12

Package **mock-api-portal-1.12.0.tar.gz**, compared with **mock-api-portal-1.11.0.tar.gz**.

### Changes in this round

1. **Configurable user values** – Domain, Team, Technology and Role are no longer fixed lists. *Admin view →
   Configurations* (replaces the *Folders* tab) shows a TYPE / VALUES list (DOMAIN, TEAM, TECHNOLOGY, ROLE); smadmin
   adds values with *+ New value* and deletes values no user has. The user form (create / edit), the user validation
   and the API registration (base path) use these values. Defaults seeded on first start: DOMAIN fixedline, gsm ·
   TEAM bau, project · TECHNOLOGY ms, esb, portal · ROLE dev, test. Values: lower-case letters, digits, `_`.
2. **Analytics tab** (*Admin view → Analytics*) – every mock API request (`/api/…`, `/apis/…`) is recorded with the
   `morgan` request logger. One row per API, most used first: *API requests*, *Successful requests* (status < 400),
   *Failed requests* (status ≥ 400), average response time, requests per method, last request; totals on top,
   auto-refresh every 10 s, *Reset*. Counters are kept in NeDB (`admin/analytics.db`).
3. The folder feature (tab, `/admin/folders` endpoints) is removed; existing folder data is left untouched on disk.

### Added

| File | Why |
|---|---|
| `server/src/analytics.js` | morgan logger, per-API counters (saved in NeDB), `GET` / `DELETE /admin/analytics` |
| `server/node_modules/morgan` (1.12.1) + `basic-auth` 2.0.1, `safe-buffer` 5.1.2, `on-headers` 1.1.0 | request logging for Analytics |
| `frontend/dist/assets/index--Z-SV9Bp.js` | rebuilt portal: Configurations and Analytics tabs (replaces `index-B8F6UI_B.js`) |
| `frontend/dist/assets/index-B9nhcY2p.css` | rebuilt portal styles (replaces `index-MNGDbV4Y.css`) |

### Modified

| File | Why |
|---|---|
| `server/src/accounts.js` | user values from the `configs` collection (seeded with defaults), `/admin/configurations` endpoints, folder endpoints removed |
| `server/src/index.js` | morgan logger mounted, analytics routes (smadmin only), API registration checks the configured values, analytics saved on shutdown |
| `server/src/store.js` | NeDB collections `configs` and `analytics` (also synced to Redis) |
| `server/package.json` | version 1.12.0, dependency `morgan` |
| `server/package-lock.json` | `morgan` and its dependencies |
| `frontend/dist/index.html` | references the rebuilt assets |
| `DEPLOY.md` | version 1.12.0 |
| `build-info.json` | version 1.12.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-B8F6UI_B.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-MNGDbV4Y.css` | replaced by the rebuilt portal |

### Unchanged

`start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/src/{generate,patch,remote,tags,enums,mockgen,query}.js`, all other `server/node_modules` packages.

### Upgrade notes

* Existing users keep their values; the defaults above are created the first time the configuration is read.
* Requests are counted from the moment 1.12.0 runs; earlier traffic is not known.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.12.0.tar.gz` |
| `DEPLOY.md` | version 1.12.0 |
| `mock-api-portal-1.12.0.tar.gz.sha256` | new checksum |
| `change.md` | round 12 section added |

## Modification in round 11

Package **mock-api-portal-1.11.0.tar.gz**, compared with **mock-api-portal-1.10.0.tar.gz**.

### Changes in this round

1. **Raw JSON of the whole record is editable** – on the record details page, *Raw JSON* (top) now has *Edit JSON*;
   *Save JSON* sends the changes as a JSON Patch, stores the record and refreshes the page (heading, fields and
   sections) with the saved record. The record id cannot be changed there (use *Copy record*).
2. **# Records** – the stored count is shown next to the label in brackets, e.g. `# Records (3 stored)`, instead of
   on its own line.
3. **Raw JSON tree** (all places) – nodes expand with a **+** icon and collapse with a **−** icon instead of `[>]` / `[V]`.

### Added

| File | Why |
|---|---|
| `frontend/dist/assets/index-B8F6UI_B.js` | rebuilt portal (replaces `index-xwZ1TNsT.js`) |
| `frontend/dist/assets/index-MNGDbV4Y.css` | rebuilt portal styles (replaces `index-kEBL_2NK.css`) |

### Modified

| File | Why |
|---|---|
| `frontend/dist/index.html` | references the rebuilt assets |
| `server/package.json` | version 1.11.0 |
| `server/package-lock.json` | version 1.11.0 |
| `DEPLOY.md` | version 1.11.0 |
| `build-info.json` | version 1.11.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-xwZ1TNsT.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-kEBL_2NK.css` | replaced by the rebuilt portal |

### Unchanged

`server/src/*` (API server not changed), `start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/node_modules`.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.11.0.tar.gz` |
| `DEPLOY.md` | version 1.11.0 |
| `mock-api-portal-1.11.0.tar.gz.sha256` | new checksum |
| `change.md` | round 11 section added |

## Modification in round 10

Package **mock-api-portal-1.10.0.tar.gz**, compared with **mock-api-portal-1.9.0.tar.gz**.

### Changes in this round

1. **Merge Patch – arrays with a unique key.** When a list's item key is marked *Unique* (e.g. `agreementItem.id`),
   an array sent in a merge patch no longer replaces the list: items whose key matches are merged into the existing
   item, items without the key (or with an unknown key) are appended as new items, and for every new item the
   *Create (post)* (ids, regex, missing values), *Map* and *Must* rules run, as for POST / JSON Patch `op: add`.
   Lists without a unique key and `?pathMode=index` keep RFC 7396 behaviour.
2. **PATCH `?fields=`** – the response contains only the given paths (`id` always included); without `fields` the
   full stored record is returned.
3. **HEAD** on `/api/{basePath}/{name}/{version}` and `/{id}` – status, `Content-Type` and `Content-Length` of the
   GET response, no body.
4. **Users** get Domain (fixedline, gsm), Team (bau, project), Technology (ms, esb, portal) and Role (dev, test) –
   required on create, editable, shown in the list.
5. **Login page** (email + password); all portal pages and `/admin/*` endpoints need a login (Bearer token,
   sessions stored in NeDB). Built-in `smadmin` / `smadmin` (password configurable with `SMADMIN_PASSWORD`).
   *Admin view* (users, folders) is shown to and allowed for smadmin only. Registered users log in with their
   email and generated password; inactive users cannot log in.
6. **Register API with a base path from the user** – `+` shows `{domain}-{team}-{technology}-{role}-` read-only and
   an env drop-down (dev, st, sit) (smadmin chooses all parts). APIs are stored under the key
   `{basePath}__{name}__{version}` and served at `/api/{domain}-{team}-{technology}-{role}-{env}/{name}/{version}`;
   base path + name + version is unique. New **# Records** field (default 10, editable next to *Version*): POST and
   *Create mocks* are refused with `422 RECORD_LIMIT_REACHED` when the limit is reached.
7. **Register page tabs** Dev / ST / SIT list the APIs the user can access (`{scope}-dev/st/sit`); smadmin sees all
   APIs (APIs registered before 1.10.0 appear under *Other*).

### Added

| File | Why |
|---|---|
| `frontend/dist/assets/index-xwZ1TNsT.js` | rebuilt portal: login page, env tabs, base path, # Records, user fields (replaces `index-DYpTR2x8.js`) |
| `frontend/dist/assets/index-kEBL_2NK.css` | rebuilt portal styles (replaces `index-E-mO4X7X.css`) |

### Modified

| File | Why |
|---|---|
| `server/src/patch.js` | merge patch: arrays with a unique key are merged by key, new items appended and reported for generation |
| `server/src/index.js` | login-protected `/admin`, API access by user scope, base-path registration, `PATCH /admin/apis/{key}` (# records), record limit on POST / mocks, `/api/{basePath}/{name}/{version}` routing (old paths still work), HEAD, PATCH `fields`, new-item rules for merge patch, `SEED_APIS` with a base path |
| `server/src/accounts.js` | login / logout / me, sessions, `smadmin`, user Domain / Team / Technology / Role, access rules |
| `server/src/store.js` | API key with base path, `maxRecords` (default 10, also set on existing APIs), `admin/sessions.db` collection |
| `server/package.json` | version 1.10.0 |
| `server/package-lock.json` | version 1.10.0 |
| `frontend/dist/index.html` | references the rebuilt assets |
| `DEPLOY.md` | version 1.10.0, smadmin login, `SMADMIN_PASSWORD` / `SESSION_HOURS` |
| `build-info.json` | version 1.10.0, build time |
| `change.md` | this section |

### Removed

| File | Why |
|---|---|
| `frontend/dist/assets/index-DYpTR2x8.js` | replaced by the rebuilt portal |
| `frontend/dist/assets/index-E-mO4X7X.css` | replaced by the rebuilt portal |

### Unchanged

`start.sh`, `openshift/*`, `samples/agreement.json`, `server/data/`,
`server/src/{generate,remote,tags,enums,mockgen,query}.js`, `server/node_modules` (no new packages).

### Upgrade notes

* After the upgrade every portal page asks for a login – sign in with `smadmin` / `smadmin`, then change it with
  `SMADMIN_PASSWORD`. Mock data URLs (`/api/...`) stay open for clients.
* Users created before 1.10.0 have no Domain / Team / Technology / Role: they can log in but see no APIs until
  smadmin edits them.
* APIs registered before 1.10.0 keep their `/api/{name}/{version}` URL and are visible to smadmin (tab *Other*).
* Existing APIs get *# records* = 10; raise it in the API section if they already hold more records.

### Files next to the .tar

| File | Change |
|---|---|
| `Dockerfile` | `PACKAGE` points to `mock-api-portal-1.10.0.tar.gz` |
| `DEPLOY.md` | version 1.10.0, smadmin login, new settings |
| `mock-api-portal-1.10.0.tar.gz.sha256` | new checksum |
| `change.md` | round 10 section added |

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
