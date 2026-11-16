# CodeRenewables suite storage, protocol v1

One shared project for WindNudge, SolarNudge, LossStack and WattOdds. A value set in one tool appears in the next without files or copy-paste. Everything stays in the user's browser: nothing is uploaded and there are no accounts.

- `hub.html`: a page with no visible content. It owns the storage in `localStorage` of `coderenewables.com` and answers messages from the tools.
- `suite.js`: the client. Each tool loads it, and it talks to the hub through a hidden iframe. It exposes `window.CRSuite` and draws the project bar.

`v1` is frozen. Never change message shapes or storage keys here. Add a `v2` folder instead.

## Why the hub lives on `coderenewables.com`

Each tool is a different origin, so tools cannot read each other's `localStorage`. The hub is embedded from `*.coderenewables.com`, which is the same site as the tools, so browsers give it the same storage for every tool. A hub on any other domain would be partitioned per tool and the sharing would silently stop.

**Hosting requirement:** the hub must be framable by `*.coderenewables.com`. `_headers` at the repo root sets `Content-Security-Policy: frame-ancestors https://*.coderenewables.com` for `hub.html`. This file only takes effect on Cloudflare Pages. If the home page is served by GitHub Pages, it cannot set headers, and the default `X-Frame-Options` may block the hub. In that case every tool falls back to local mode and the bar says `Saved in this tool only`. Check after deploy:

```sh
curl -sI https://coderenewables.com/suite/v1/hub.html | grep -iE 'x-frame|content-security'
```

There must be no `X-Frame-Options` line, and any `frame-ancestors` must allow `*.coderenewables.com`.

## Storage layout (hub origin)

| Key | Value |
| --- | --- |
| `cr-suite:index:v1` | `{ "currentId": "p-…" or null, "projects": { "p-…": { "name", "tech", "updated" } } }` |
| `cr-suite:project:<id>` | `{ "schema": "cr-suite/1", "id", "name", "tech": "wind" \| "solar" \| "hybrid", "created", "updated", "rev", "sections": { … } }` |

Each section is `{ "rev", "updated", "value" }`. The section names are exactly `windnudge`, `solarnudge`, `lossstack` and `wattodds`. Each tool writes only its own section and reads upstream ones:

| Section | Written by | Read by |
| --- | --- | --- |
| `windnudge` | WindNudge | LossStack, WattOdds |
| `solarnudge` | SolarNudge | LossStack, WattOdds |
| `lossstack` | LossStack | WattOdds |
| `wattodds` | WattOdds | bar summaries only |

`rev` on a project goes up on every write, rename, clear and clear-section. A section value is limited to 400 000 characters of JSON.

## Messages

Request, tool to hub: `{ crSuite: 1, id, op, args }` posted to the hub origin.
Reply, hub to tool: `{ crSuite: 1, id, ok: true, result }` or `{ crSuite: 1, id, ok: false, error }`.
Event, hub to tool: `{ crSuite: 1, event: "changed", projectId, section, currentId }`. It is sent after any change, and also when another tab changes storage (then `section` is `null`).

| `op` | `args` | Result |
| --- | --- | --- |
| `ping` | none | `{ version: 1 }` |
| `list` | none | `{ currentId, projects }`, newest first |
| `get` | `{ id }` | the project document |
| `create` | `{ name, tech }` | the project, which becomes current |
| `rename` | `{ id, name }` | `{ id, name }` |
| `remove` | `{ id }` | `{ id }` |
| `setCurrent` | `{ id }` or `{ id: null }` | `{ currentId }` |
| `write` | `{ id, section, value }` | `{ rev, sectionRev, updated }` |
| `clearSection` | `{ id, section }` | `{ rev }` |

Error codes: `bad_args`, `not_found`, `too_large`, `quota`, `failed`, and `timeout` (client only).

The hub accepts a message only when its origin matches `https://*.coderenewables.com` or `http://localhost` / `http://127.0.0.1` (any port). It replies only to the origin that asked, and sends events only to the last origin that asked.

## Client: `window.CRSuite`

```js
CRSuite.ready            // Promise<{ mode: "shared" | "local" }>; never rejects
CRSuite.mode             // "pending" | "shared" | "local"
CRSuite.list()           // Promise<{ currentId, projects }>
CRSuite.current()        // Promise<project | null>
CRSuite.open(id)         // Promise<project>; id null detaches from any project
CRSuite.create({ name, tech })
CRSuite.rename(id, name)
CRSuite.remove(id)
CRSuite.write(section, value)     // rejects with Error("no_project") when none is current
CRSuite.clearSection(section)
CRSuite.section(project, name)    // the section's value, or null
CRSuite.onChange(fn)              // fn({ project, section, own }); returns an unsubscribe function
CRSuite.mountBar({ tool, after }) // tool: "windnudge" | "solarnudge" | "lossstack" | "wattodds"
CRSuite.notice(text, { action, onAction })
CRSuite.toolUrl(tool, id)         // the tool's URL with ?project=<id>
```

Local mode (hub unreachable, `file://`, blocked frame, or no answer within 2 s) uses the same API and the same layout in the tool's own `localStorage`. It never syncs to the hub later.

Test hooks: `window.CR_SUITE_HUB` overrides the hub URL, and `window.CR_SUITE_TOOLS` overrides tool URLs. Both must be set before `suite.js` loads.

## Tests

```sh
node tests/suite.test.js   # from the repository root; needs Playwright with Chromium
```

The test starts two static servers on ports 8100 (hub) and 8101 (fixture page), then checks sharing between pages, error codes, the origin rule, local fallback and the bar at 375 px.

Copyright 2026 Nithish Seenivasagam (coderenewables.com). Apache-2.0.
