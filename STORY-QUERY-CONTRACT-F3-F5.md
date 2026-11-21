# Story-query / integration contract — F3–F5 local build

**Provided from:** `cortico-world-fun@0.3.2-story.2` (earliest version in this ticket that declares these methods).

**Status:** packaged for offline review, not published or installed. The receiving host / “Fish Every Day” extension must not import this package, inspect its storage, or dispatch its methods. The caller is the host-side conversation model, using only tool declarations actually installed in that host. This is a contract for this local build, not a claim about another extension's deployed API or host availability.

## Public read-only methods

All six methods are declared with `read,snapshot` and accept **only** the listed JSON parameters; no extra properties. Their results are observation-only and do not start/end a trip, apply a choice, modify a file or write a calendar, life record or long-term memory.

| Method | Arguments | Result / scope |
| --- | --- | --- |
| `fun_story_places` | `{}` or `{"id":"cafe"}` | Stable place ID, name and playability; an ID adds the current description, aliases, current areas and hours. |
| `fun_story_candidates` | `{}` | Enabled story cards, each marked with current availability and reason, plus non-spoiler public synopses. Unavailable enabled cards can appear; no event nodes, choice results or future branch text are returned. |
| `fun_story_detail` | `{"id":"duo-cafe-date"}` | One public metadata card, availability and reason; no authored nodes or branches. |
| `fun_story_current` | `{}` | `state: none/active/draft`, or the active trip's ID, actual logged events/choices/timeline and current pending event/options. It does not submit or progress a choice. |
| `fun_story_recap` | `{}` or `{"id":"<saved-trip-id-or-run-id>"}` | Actual stored story-trip recap and facts only. Without an ID returns the most recent saved story trip. No write-back. |
| `fun_story_schedule` | `{}` or `{"id":"duo-cafe-date"}` | Copyable text for one eligible candidate, explicitly not a scheduled outing, persisted calendar event or launch. |

### Host receipt and errors

The World handler returns `{text: "<JSON-serialized result>", failed?: true}`; parse `text` to read the structured result. It also retains typed fields for direct local panel callers. `failed: true` indicates a query that did not succeed. In the JSON payload, expected errors have `ok:false`, a stable `code` where assigned (`NOT_FOUND`, `NOT_AVAILABLE`, `NO_CANDIDATE`, `NO_MEMORY`, etc.) and a human-readable `error`; a missing story/place or no schedule candidate must not be treated as an empty successful start. Errors do not start a story either. Callers should treat a failed response or malformed/missing text as unavailable and may retry a fresh read, not infer success.

Example (`fun_story_detail`, illustrative):

```json
{"ok":true,"queryAt":"<host timestamp>","story":{"id":"duo-cafe-date","title":"咖啡店的双人约会","placeId":"cafe","participation":"duo","duration":"20 分钟","available":true,"reason":null}}
```

The above JSON is inside the standard result's `text` field. Actual card fields are determined by the active place and installed data; do not rely on this shortened illustration as a complete schema.

## Launching and updating a story

There is **no public `fun_story_start` tool** in this contract. The supported explicit start in this build is the story panel operation `start`, with the current status `startStamp`, `packId`, and current `revision`. The panel rechecks those conditions before starting; ordinary `fun_go` is not a request to launch a particular story. Manual story actions use the panel's current `tripId`, `stamp` and current choice/step. Fish must never forge an owner action or interpret an owner turn as consent. A host integrator should not invent a different launch endpoint.

`fun_story` is an author-management tool, not a public query. It supports local list/template/validate/preview/playtest/export/import/enable/disable/remove actions and can write story definitions. Do not use it for read-only candidate lookup.

## v2 contextual-reference shape

Version 2 may include up to 24 optional references in the author's advanced JSON:

```json
{"area":"角落的双人座","afterNode":"first","afterChoice":"read","audience":"fish","text":"只在当前场景使用的线索。"}
```

`area` must be an authored area; `afterNode` must exist. Optional `afterChoice` must belong to that exact node. `audience` is exactly `player`, `fish`, or `dm`. Invalid fields, nonexistent nodes/choices, unsafe markup/path/network text, and non-v2 reference definitions fail strict validation rather than being silently dropped. No additional tool, cross-world call or external knowledge retrieval is used.

A reference is eligible only when that exact pack/revision has actually triggered `afterNode`, the run is currently in the reference's `area`, and (if provided) the player actually selected `afterChoice`. At most six eligible entries for one audience are passed at once. Unlocks are derived from this run's persisted story progress and choices; not from node count, guessed future state, or a separate World file.

- `player`: rendered as plain text in the current story panel only; never put into public candidate/detail/current/recap/schedule tool responses.
- `fish`: added to fish's current cognition request only; fish proposals must still select an offered option and cannot progress owner/joint actions. Where private references were supplied, the public choice reason is replaced with a fixed, non-sensitive reason.
- `dm`: added only to the current optional DM request; DM must propose a current option for owner approval, and private-reference narration is replaced in the public pending proposal with a fixed neutral explanation.
- A different audience, area, node or unselected choice remains unavailable. The underlying public query does not return reference definitions or trigger conditions. Disabling DM or lacking a cognition interface leaves fixed/manual play available.

## Side-effect evidence and checks

`fun-world/test/story-stages.test.mjs` verifies all six queries are tagged read-only and preserve both saved state and the story-library bytes; it rejects future branch material in results and verifies version-one unknown duration remains unknown. A further end-to-end check confirms that a gated reference stays absent before its node and choice are actually reached; after restart it is projected only to its eligible audience; no DM/fish reference appears in panel state, public response or saved choice reason. It also validates host-readable text JSON and failure markers. The current round's focused gating and version-one compatibility tests pass.

Other local evidence is in the companion execution report and verification directory: full test and `verify` result logs, single-file web UI build, installed-form offline tarball load, description/runtime tool parity, original-source hash check, and patch replay. These tests establish only the local implementation with test stubs. This contract has **not** been verified against a real host, actual “Fish Every Day” version, provider credentials/API, real calendar/write entrypoint, user backup migration or narrow-screen Coo.

## F4–F5 operating boundary

- Optional text DM uses only the host `cognition.request`; host provider/model selection and credentials remain host-managed. Each real dispatch reserves durable budget before requesting; failure, retry and cancellation count; usage is recorded only if actually reported. The text DM is a proposal, never a state mutation.
- Checkpoint forks create a distinct `runId`, retain source references and already-spent budget, and refuse incompatible content/resource versions. A non-canonical fork does not overwrite its source or mark a global canonical completion.
- Images default off. This build does not assert a verified host image-job/result channel; it presents a clear unavailable state instead of bypass HTTP. Existing bundled art or an explicit user-selected local import remains independent of text play.
- Recap is a fact summary. Copying it does not write elsewhere. Any life/calendar write must be an explicit separate action by the authorized caller through a real installed host interface; none is done by these six queries.
