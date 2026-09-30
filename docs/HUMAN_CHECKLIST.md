# The human checklist — what is left, and the order to do it in

Everything in this repository that can be built, measured or checked by running something is done. What remains
needs an account, an identity, a camera or a judgement, and none of those can be produced by a test.

This file is the ordered list of what remains. It is **ordered by dependency**: a step sits where it sits because
an earlier one produces something it needs. Where two steps need nothing from each other, the one that unblocks
more comes first. Nothing here is a preference — every arrow is a link that does not exist until an earlier step
creates it.

## The deadline

Submissions close on **2026-09-30, 23:59 UTC**, the date `CAHIER_DES_CHARGES.md` carries. This list was written on
2026-09-30 at 08:21 UTC, roughly fifteen hours before that. If you are reading it later than that, read *The
shortest path that still meets the rules* below before starting at H1.

## What is already done, so that it is not done twice

- **The CoinMarketCap account and the key.** `.env` carries `CMC_API_KEY` and it has been spent: five capture
  sessions between 2026-09-24 and 2026-09-26 recorded **392 answers** reporting **288 credits**, with the key masked
  in every one. `docs/EVIDENCE.md`, section 7, names each capture and its directory.
- **Everything the rules ask a repository to contain.** The engine and its seven checks, the MCP server and its four
  tools, the demonstration agent, the web interface, the calibration on the first fifty assets by market
  capitalisation, the API audit, and the documents: `README.md`, `docs/ENDPOINTS.md`, `docs/EVIDENCE.md`,
  `docs/CALIBRATION.md`, `docs/API_AUDIT.md`, `docs/API_FEEDBACK.md`, `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md`
  and `docs/X_POST.md`.
- **The texts to paste.** The submission, the video script and the four posts are written, and each one is read back
  against this repository by a test. What none of them can carry is a link.

## The five links nobody here can fill in

Three documents wait on the same handful of links, written `{{LIKE_THIS}}`. Each one comes out of a step below, and
is used by the documents in the last column.

| Placeholder | Produced by | Waits in |
| --- | --- | --- |
| `{{REPO_URL}}` | H3 | `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md`, `docs/X_POST.md` |
| `{{DEMO_URL}}` | H4 | `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md`, `docs/X_POST.md` |
| `{{VIDEO_URL}}` | H7 | `docs/SUBMISSION.md`, `docs/X_POST.md` |
| `{{BUIDL_URL}}` | H8 | `docs/X_POST.md` |
| `{{X_POST_URL}}` | H9 | `docs/SUBMISSION.md` |

That table is why the order below is what it is: the submission needs four of them, the post needs four, and one of
each pair points at the other — which is what H10 is for.

## The ten steps

| Step | What it produces | Depends on | Comes from |
| --- | --- | --- | --- |
| H1 | a decision about what enters the history | — | `.loop/BLOCKED.md` |
| H2 | a commit | H1 | `.loop/BLOCKED.md` |
| H3 | `{{REPO_URL}}` | H2 | `TASKS.md` |
| H4 | `{{DEMO_URL}}` | H3 | `TASKS.md` |
| H5 | a reading of the tone | — | `TASKS.md` |
| H6 | an account that can submit | — | `TASKS.md` |
| H7 | `{{VIDEO_URL}}` | H3 | `TASKS.md` |
| H8 | `{{BUIDL_URL}}` | H3, H4, H5, H6, H7 | `TASKS.md` |
| H9 | `{{X_POST_URL}}` | H3, H4, H7, H8 | `TASKS.md` |
| H10 | a submission that carries its own post | H8, H9 | `TASKS.md` |

H5 and H6 depend on nothing and can be done at any point before H8. They are placed where they are because H8 is
the first step that needs them, and because both are short.

---

## H1 — Decide what does not enter the history

**Depends on** nothing. **Do it before H2**, because a commit is the moment this decision stops being reversible
without rewriting history.

Four things sit in the working tree that a reader of the repository does not need, and each one has a different
answer:

1. **The two interrupted calibration walks** — 217 loose `fixtures/calibration/E*.json` files from 2026-09-25, and
   `fixtures/calibration/live-2026-09-26/`, 123 files from a walk stopped at 25 assets of 50. Together just under
   2 MB of JSON. Nothing reads either: the calibration, the audit and the tests all read
   `fixtures/calibration/live-20260926T1044Z/`, the complete walk.
   **Keeping them is the documented state**: `docs/EVIDENCE.md` says both are there and why no figure counts them,
   and `tests/evidence-doc.test.ts` requires at least one of the two to still exist, so that the sentence is
   describing a real repository rather than a tidy one. If you would rather they were gone, remove them **and** the
   paragraph of `docs/EVIDENCE.md` that describes them, **and** the two tests that read them —
   `tests/evidence-doc.test.ts` and `tests/human-checklist-doc.test.ts` — then run `npm test`, in that order.
   Removing only one of the two directories changes nothing and needs no edit beyond the counts above.
2. **The two logs of that interrupted walk** — `.loop/calibrate-live.out` and `.loop/calibrate-live.progress`. They
   are the loop's own journal of the interruption, in French, like the rest of `.loop/`. Keeping or removing them
   changes nothing that is read.
3. **The two files Next.js writes on every `npm run web:dev`** — `web/AGENTS.md` and `web/CLAUDE.md`. Neither was
   written by this project, and `web/CLAUDE.md` would inject Next's own rules into an agent session opened under
   `web/`. Both are already in `.gitignore`, so they cannot enter a commit. To be rid of them for good, delete them
   and set `agentRules: false` in `web/next.config.ts` — a Next setting, worth touching only against the Vercel
   build the README describes.
4. **`.env`.** It is in `.gitignore` and `scripts/check-secrets.sh` refuses a commit that carries it. Nothing to do;
   listed here so that the absence of an action is deliberate.

**How to tell it worked**: `npm test` still passes, and the short status of the working tree lists nothing you did
not expect.

---

## H2 — Enable the versioned hook, then commit the work

**Depends on** H1.

The loop wrote every file in this repository and could commit none of them: a global agent hook refuses git commands
that change the state of a repository, and refuses them on this branch in particular. So the working tree holds the
whole project, and the history holds one commit — the specification. `.loop/BLOCKED.md` records this at every
iteration and ends with the exact command to run, path list and commit message included.

1. `npm run prepare` — writes `core.hooksPath=.githooks` into this clone, which is what makes `.githooks/pre-commit`
   run `scripts/check-secrets.sh` on the commit you are about to make. Doing it first means the commit checks itself.
   If you would rather know before you stage anything, `scripts/check-secrets.sh --worktree` asks the same question of
   every file a clone would carry. It was green when this list was written.
2. Stage and commit, from a terminal rather than from an agent session. `.loop/BLOCKED.md`, option 3, carries the
   command: it adds directories rather than files, so nothing the loop wrote is left out.
3. **A convention has to be settled first.** `CLAUDE.md` asks for commits like `T3.2: add C1/C2 price divergence
   checks` on the current branch; the global hook asks for a branch named `feature/ASIN-{n}-…` and a Conventional
   Commit. The two cannot both be satisfied, and the choice is yours — this repository is not an ASIN one and has no
   remote yet, so nothing here depends on the answer except the message.

**How to tell it worked**: the one-line log shows more than the single commit it shows today, the status is clean
apart from what H1 left, and `scripts/check-secrets.sh --history` prints that no secret was detected.

---

## H3 — Create the public repository and push

**Depends on** H2. **Produces** `{{REPO_URL}}`, which three documents wait for.

The rules ask for a public repository, and every link below this line is under it. Push the branch H2 committed.

**How to tell it worked**: open `{{REPO_URL}}` in a logged-out window — a 404 means it is still private, and the
submission, the video end card and the post would all carry a dead link. `docs/SUBMISSION.md` asks for this check
again before submitting; doing it here saves the second discovery.

---

## H4 — Deploy the web interface to Vercel

**Depends on** H3. **Produces** `{{DEMO_URL}}`.

The application lives in `web/` and reads three things above its own directory, so the repository — not `web/` — is
the root the build has to see. `web/vercel.json` carries the build and install commands. Two project settings cannot
be expressed in that file and have to be set in the dashboard:

| Project setting | Value |
| --- | --- |
| Root Directory | `web` |
| Include source files outside of the Root Directory in the Build Step | enabled |

Then the environment variables, under Settings → Environment Variables. The README lists all seven with what happens
when each is unset; two of them are the decision worth making here:

- `CMC_API_KEY` — the only secret, and the variable the backlog asks for. Set it.
- `SECOND_OPINION_MODE` — `replay` unless the key is meant to be spent. A verdict reads several endpoints, so a live
  public URL spends credits on every visit that the cache does not already hold. With `replay` the deployment serves
  the recorded answers and says so under the verdict, which is what the video films anyway.

The other five — `SECOND_OPINION_FIXTURES`, `SECOND_OPINION_AUDIT_FILE`, `SECOND_OPINION_RWA_INDEX`,
`CMC_CACHE_DIR` and `SECOND_OPINION_ROOT` — have defaults that hold on Vercel and can be left unset.

No variable may be given a `NEXT_PUBLIC_` prefix: that prefix is inlined into the browser bundle, and the interface
refuses to start if a credential appears under one.

**How to tell it worked**: the search page, an asset page and the audit page all answer on `{{DEMO_URL}}`. The full
reasoning behind both settings is in `README.md`, under *Deploy it to Vercel*.

---

## H5 — Read the tone of what will be published about the API

**Depends on** nothing. **Needed by H8.**

This is the one step in the list that is a judgement and nothing else. Two pieces speak about the API to the team
that owns it:

- `docs/API_AUDIT.md` — 24 published entries, each citing a recorded answer.
- the *What the API made possible, and what took work* section of `docs/SUBMISSION.md`.

Both are written as observations rather than complaints, and `src/audit/review.ts` holds a gate that refuses a list
of accusatory words and of turns of phrase that state a cause — every document in `docs/` passes through it. What
the gate cannot judge is whether a paragraph *reads* as helpful, which is why the backlog keeps this step for a
person. `docs/API_FEEDBACK.md` is the longer form of the same material and is worth the same reading.

**How to tell it worked**: you would be comfortable if the API team read it over your shoulder.

---

## H6 — Register on DoraHacks under the same e-mail as the CoinMarketCap account

**Depends on** nothing. **Needed by H8.**

The CoinMarketCap account exists and its key is what every measurement in this repository was taken with. The
hackathon ties a submission to that key through the e-mail address, so the DoraHacks account has to carry the same
one. `docs/SUBMISSION.md` asks for this check again before submitting.

**How to tell it worked**: both accounts show the same e-mail address.

---

## H7 — Record the video and upload it

**Depends on** H3, for the end card. **Produces** `{{VIDEO_URL}}`.

`docs/VIDEO_SCRIPT.md` is eight shots, 90 seconds, each one quoting lines from a real run — the tests spawn the MCP
server, replay both scenarios and require every *Land on* line to appear in the run its shot names. Shots 1 to 7
need no key, send no request and spend no credit, so the whole recording can be made on a clone with an empty
`.env`. Its *Before you hit record* section carries seven things to set up first; three of them are the ones that
show up in a finished video:

- **Build once** — `npm install`, `npm run web:install`, `npm run build` — so that no shot films a compiler.
- **Load both browser tabs before recording**, so the first compile of a dev server is not in the video.
- **No key on screen**: do not open `.env`, do not run `npm run check:env`, do not film a shell history. Nothing in
  this project prints the key; a video is not the place to rely on that.

The script also lists five things the narration must not claim, and what to cut if the edit has to be shorter.

If H4 is done, shot 6 can film `{{DEMO_URL}}` instead of `http://localhost:3000`; if it is not, the local page
carries the same verdict from the same engine.

**How to tell it worked**: the upload has a public URL, and the end card carries no `{{`.

---

## H8 — Create the BUIDL page on DoraHacks

**Depends on** H3, H4, H5, H6, H7 — four links and one reading. **Produces** `{{BUIDL_URL}}`.

`docs/SUBMISSION.md` carries the text between its two `submission text` markers. Everything outside them is for the
person pasting it and is not part of it. Its *Before pressing submit* section is four checks; the first is the one
that a hurried submission gets caught by:

1. Replace all four placeholders. A search for `{{` in the pasted text has to come back empty.
2. Same e-mail on both accounts — H6.
3. `{{REPO_URL}}` opens in a logged-out window — H3.
4. The tone has been read — H5.

The track is **AI Agents and Automation**, and the text names the seventeen endpoints the code may call, the four the
plan refused, and what a verdict costs in credits.

**How to tell it worked**: the BUIDL page shows the text with four live links and no braces.

---

## H9 — Publish the post on X

**Depends on** H3, H4, H7, H8. **Produces** `{{X_POST_URL}}`.

`docs/X_POST.md` carries four drafts. **Post 1 is the one the rules ask for** — it carries the BUIDL link, the video
and `#BuildwithCMC`, and it stands alone. Posts 2 to 4 are a thread under it, for a reader who wants to know how the
thing works before clicking anything. Publish post 1, then the others as replies, in order.

Each draft is counted the way X counts — one per character, 23 per link whatever its length — and the margins are
thin on purpose: post 1 is 274 of 280. If the counter in the compose box disagrees, the counter is the authority:
trim the prose, never the links or the hashtag.

**Nothing goes out carrying a `{{`.** Searching the compose box for two opening braces is the last check before
send, exactly as it is before pressing submit. A post whose placeholder cannot be filled in is dropped rather than
published with a gap in it — if H4 did not happen, post 4 goes out without its last line, re-counted, or not at all.

**How to tell it worked**: post 1 is live, and its own URL is copyable.

---

## H10 — Put the post back into the submission

**Depends on** H8, H9.

Two links point at each other: the post carries the BUIDL link, and the BUIDL's *Links* table carries the post. H8
and H9 resolved the first direction; this step resolves the second. Copy the URL of post 1 into the `{{X_POST_URL}}`
row of the BUIDL text and save.

If DoraHacks hands out no URL before a BUIDL is submitted, H8 and H9 swap: submit first, publish the post, then edit
the BUIDL to add it. Either way this step is last, and it happens after the post is live — so the post has to go out
with enough time left before the deadline to paste its own URL back.

**How to tell it worked**: a search for `{{` on the saved BUIDL page comes back empty.

---

## The shortest path that still meets the rules

If time runs short, the rules ask for a public repository, a working demonstration, the post on X carrying the BUIDL
link and the video and `#BuildwithCMC`, the endpoints named, proof of a real call, a note on the API, and one track.
Section 7 of `CAHIER_DES_CHARGES.md` maps each of those to what produces it.

**H4 is the only step that can be dropped** without losing one of them: the demonstration requirement is met by the
video, and `docs/X_POST.md` already says what post 4 does when the deployment did not happen. Everything else is
either a link the submission carries or the account that submits it.

H1 can be answered with "keep everything" in one sentence, which is the documented state.

## What the loop still owes, and what it does not

Nothing. Every task of `TASKS.md` that is not reserved for a person is ticked, so no step below waits on the loop.

The last three tasks of the backlog stood together at the end, and all three are now done. **T9.1** copied the
repository-visible files into a temporary directory and ran the install, the build and the three gates there.
**T9.2** read each acceptance criterion of section 8 of the specification against a command and wrote the eight
answers into `docs/FINAL_CHECK.md` — the file this list used to name as the one that did not exist yet. **T9.3**
looked for a key across the git history, the staged changes, and every file a clone would carry, and found none.
Read `docs/FINAL_CHECK.md` before H5: it records what each criterion rests on, and the three reservations it draws,
two of which H2 settles.

T9.3 is worth one note, because H2 is what changes its meaning. It reads the history for a key, and today that
history holds one commit: that scope will have proved nothing about the project's own files until **H2** puts them
there. So it gained a third scope, `scripts/check-secrets.sh --worktree`, which reads every file a clone would carry
rather than commits that do not exist yet — green over all of them, and watched to fail on a planted key-shaped value
first. `docs/FINAL_CHECK.md` records how many files that was. That is the second reason H2 is where it is, and the
reason waiting for it is not waiting blindly.

## Where each of these came from

The backlog reserves six lines for a person, and section 9 of `CAHIER_DES_CHARGES.md` lists the same six. They are
quoted here from the French backlog, verbatim and without their backticks, so the mapping can be checked rather than
believed:

| The line reserved for a person in `TASKS.md` | Step |
| --- | --- |
| Compte CMC + inscription DoraHacks (même e-mail) + clé dans .env | H6 |
| Dépôt GitHub public | H3 |
| Déploiement Vercel + variable CMC_API_KEY | H4 |
| Enregistrement de la vidéo | H7 |
| Publication du post X et soumission du BUIDL | H8, H9, H10 |
| Relecture du ton du rapport d'audit | H5 |

H1 and H2 are not on that list. They come from `.loop/BLOCKED.md`: the loop was to commit its own work at the end of
every iteration, and a global agent hook refused each time. They are in this file because they are now the only thing
between the work and a repository somebody can read.

## What keeps this list true

`tests/human-checklist-doc.test.ts` reads this file against the repository it describes. The dependency order is
checked as an order: every step a row depends on is a step this document defines, earlier in it than the row itself,
so a cycle or a forward reference fails rather than reading plausibly. The five placeholders are the ones the three
documents actually declare, each is produced by exactly one step, and each file said to be waiting for one really
carries it. Every `npm run` command is one `package.json` defines, every path exists — except the one this file says
does not, which has to still be missing — and the only URL it carries is the local one the video script films. The
six lines quoted above are read from `TASKS.md`, and each has to be a real line reserved for a person, with no
seventh invented here. The deadline is read from `CAHIER_DES_CHARGES.md`, the environment variables from `README.md`,
the counted length of post 1 from `docs/X_POST.md`, the tasks the loop still owes from `TASKS.md`, and the interrupted
walks from the directories they sit in. The wording goes through the same tone gate as the audit report.

What no test can judge is whether the order above is the one that will actually be followed under time pressure. It
is the order the links require; the rest is yours.
