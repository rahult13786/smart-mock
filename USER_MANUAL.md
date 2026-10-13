# Mock API Portal – User Manual

This manual explains the settings you find when you register an API, define its tags and create mock records.

**Quick start**

1. Log in, open **Register API** and click **+**.
2. Choose the env (dev, st, sit), enter a name and version, then **Create**.
3. Paste a sample JSON record and **Save sample**. Its records are stored and the id fields become tags.
4. Add or change tags, then **Save tags**.
5. Use the API at `/api/{base path}/{name}/{version}` from Postman or any client, or browse the records in the portal.

---

## 1. API definition

You find these settings when you open an API on the **Register API** page, under *Name* and *Version*. Press
**Save** on that line to store them.

### Max Records

The highest number of records the API may hold. It defaults to **10** for a new API. The text in brackets shows
how many records are stored now, for example `Max Records (3 stored)`.

- When the limit is reached, `POST` requests and **Create mocks** are refused with
  `422 RECORD_LIMIT_REACHED`.
- Records seeded from the sample JSON are not counted against the limit when the sample is saved.
- To make room, either raise the number or delete records.

### Array patch (sync)

This decides what a `PATCH` does with a **list** (JSON array) that the request sends. It applies to Merge Patch,
which is a JSON object body or `application/merge-patch+json`, both on one record (`PATCH …/{id}`) and on several
records (`PATCH …` without an id).

| Array patch (sync) | List items have a *Unique* tag | What happens to a list in the stored record |
|---|---|---|
| **on** | – | The stored list is **replaced** by the list in the request. 5 stored items and 2 sent leave 2. |
| off | yes (e.g. `resourceCharacteristic.name`) | Items whose unique value matches are **updated**: only the fields sent change, other fields stay. Items without a match are **added**. |
| off | no | All items sent are **added** to the stored list. |

Items that are added get the *Create (post)*, *Regex*, *Map* and *Must* rules of the tags. Fields that the request
does not mention keep their stored values. JSON Patch (`application/json-patch+json`, a list of `op`s) is not
affected by this setting.

Example: a record has 5 `resourceCharacteristic` items (`name`, `vale`, `type`, `SubType`, `availability`). The PATCH
sends `namexyz`, `valexyz` and `type`.

- **Sync on** – the record ends with 3 items.
- **Sync off, `name` unique** – the record ends with 7 items: `type` is updated, `namexyz` and `valexyz` are added.
- **Sync off, no unique tag** – the record ends with 8 items: all 3 are added.

### Patching several records at once

`PATCH /api/{base path}/{name}/{version}` accepts a list of records **without an id in the URL**. Each record
must contain its `id`.

- Every record is updated as described above, and fields that are not sent stay as they are.
- The response is the list of the full updated records.
- If one record id does not exist, nothing is changed and the reply is `404`.
- `?fields=id,operationalState` limits the response to the fields given.

```http
PATCH /api/fixedline-bau-ms-dev-dev/resource/v1
Content-Type: application/json

[ { "id": "899660111002847564", "operationalState": "finalize", "resourceCharacteristic": [ … ] },
  { "id": "899660111002847564434323", "operationalState": "finalize", "resourceCharacteristic": [ … ] } ]
```

---

## 2. Tag definition

Tags are the JSON paths of the sample that you configure, for example `id`, `status` or
`resourceCharacteristic.name`. Saving the sample creates a tag for every id field. Add other fields with
**+ Add tag**, and press **Save tags** to store the table.

### Unique

The field is the **key of the items of a list**.

- It lets a PATCH address an item by its value instead of its position, e.g.
  `/characteristic/Contract level/value`.
- In merge patches it decides whether an item is updated or added (see *Array patch (sync)*).
- The root `id` is always unique and cannot be changed. Other id fields are only unique if you tick them.
- A field can be unique only if it sits inside a list, and each list can have one unique field. A list whose items
  already have an `id` uses that id as its key.

### Searchable

The field can be used to filter records.

- In the API: `?status=Active`, `?name.like=abc` (contains), `?status.ne=Closed`, and `a,b` for "any of".
- In the portal: the search boxes on the record list.

Filtering on a field that is not searchable yet switches it on automatically.

### Create (post)

The server fills the field when a **new** record or list item is created, by `POST` or by PATCH `op: add` / an
added merge-patch item.

- **Id fields**: a new value is always generated. It follows the regex if one is enabled, otherwise the sample's
  shape, e.g. `MSA-117198-061026` becomes `MSA-583921-447201`. This is ticked by default for the root `id`.
- **Other fields**: the field is added only when it is missing. Enum fields get a random allowed value; other fields
  get random data shaped like the sample's values. Values that are sent are kept.

Copies made in the portal (*Copy record*, *Copy item*) are not changed.

### Must

The field is **required** when a record or list item is created (POST, PATCH `op: add`, added merge-patch items).
A missing, `null` or empty value is refused with `422 MUST_VIOLATION`, and the error names the exact path. A list
that is not sent at all has no items to check.

### Enum

The list of **allowed values**.

- Requests with any other value are refused with `422 ENUM_VIOLATION`, and the error names the path and the allowed
  values.
- The portal shows such fields as drop-downs.
- Values stored before the enum was defined are kept.

**Load values used in the data** fills the list from the sample.

### Regex / Map

- **Id fields – Regex.** The popup shows a *Build regex* generated from the sample, e.g. `MSA\-\d{6}\-\d{6}`, with
  example values.
  - Tick **enable** to generate new ids from it.
  - Tick **override** to type your own regex.
  - A green **[✓]** means a regex is enabled.
- **Other fields (without enum) – Map.** Choose a **sibling** field or a field of a **parent** node. When a record
  or item is created, the field gets that field's value, e.g. `stcAgreementBusinessId ← id`. Maps run after ids,
  regex and Create (post) values.

---

## 3. Create mocks

**✦ Create mocks** (next to *Sample JSON*) creates up to 10 records at once from an existing record.

| Setting | Meaning |
|---|---|
| **Sample data (Template record)** | The record that is copied: a record of the sample (`Sample record 0`, …) or a stored record. |
| **Number of mocks** | How many records to create (1–10, within *Max Records*). |

**Id fields** lists every id of the template, at any level. Use **+** / **−** to expand or collapse the section.

| Column | Meaning |
|---|---|
| **New values** | The values to use, comma-separated, one per mock in order, e.g. `A-1, A-2, A-3`. If you give fewer values than mocks, the rest are generated (you are asked to confirm). |
| **Reuse** | Keep the template's value exactly as it is. It is not available for the record id, because every mock needs its own. |
| **Auto generate** | Generate a value shaped like the template's value: digits, dates and words are changed. |
| **Replace all** | Also replace the old id everywhere else it appears in the record, e.g. inside `stcAgreementBusinessId` or item ids. |

**Other fields** – **+ Add field** adds any value path of the template, e.g. `status`, `name` or
`characteristic.value`. The next field can only be added once the current one is complete.

| Column | Meaning |
|---|---|
| **Filter (list items)** | Only for fields inside a list. First choose *All items* or an item field and value, e.g. `name = Contract level`. Only the matching items are changed, and their current value is shown. |
| **New values** / **Reuse** / **Auto generate** | Same meaning as for the id fields. Enum fields pick an allowed value. |

The mocks are saved straight away and appear in the record list.

---

## 4. Good to know

- **Base path** – APIs live at `/api/{domain}-{team}-{technology}-{role}-{env}/{name}/{version}`. The first four
  parts come from your user; the values are configured by smadmin in *Admin view → Configurations*.
- **Analytics** (smadmin) – *Admin view → Analytics* counts calls made by other systems (Postman, applications)
  per API. Calls made by the portal itself are not counted.
- **Raw JSON** – every record, list and item can be viewed as a tree (**+** / **−**), and edited with *Edit JSON*.
