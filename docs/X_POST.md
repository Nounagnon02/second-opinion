# The post on X — the draft

The rules ask for one post on X carrying the link to the BUIDL page, the demonstration video and
`#BuildwithCMC`. **Post 1 below is that post**, and it is complete on its own. Posts 2 to 4 are a thread under it,
for a reader who wants to know how the thing works before clicking anything.

Nobody here can publish it: an account is a human thing, and so is the judgement of when to press send. What this
file carries is the text, counted so that it fits, with every figure in it re-read from the repository rather than
remembered.

## The four links it cannot carry yet

Written in double braces, the same convention as `docs/SUBMISSION.md` and `docs/VIDEO_SCRIPT.md`. None of them
exists until an account, a deployment or a recording does.

| Placeholder | What to put there | It exists once |
| --- | --- | --- |
| `{{BUIDL_URL}}` | The BUIDL page on DoraHacks — the submission itself | The BUIDL is created from `docs/SUBMISSION.md` |
| `{{VIDEO_URL}}` | The demonstration video, about 90 seconds | The video is recorded from `docs/VIDEO_SCRIPT.md` and uploaded |
| `{{REPO_URL}}` | The public GitHub repository | The repository is created and this code is pushed to it |
| `{{DEMO_URL}}` | The deployed web interface | The Vercel project is deployed, as the README describes under *Deploy it to Vercel* |

The post's own link goes the other way: once it is published it fills the `X_POST_URL` placeholder of
`docs/SUBMISSION.md`.

## How long each post may be

A post on X holds 280 characters, and every link counts as 23 of them whatever its length, since X wraps links
before it counts them. Each `{{PLACEHOLDER}}` below is therefore counted as 23 — a placeholder is longer than the
link that replaces it, so counting a draft as written gives a number the compose box will not.

| Post | Carries | Counted length |
| --- | --- | --- |
| 1 | The BUIDL link, the video, the hashtag | 274 of 280 |
| 2 | Nothing to fill in | 250 of 280 |
| 3 | Nothing to fill in | 248 of 280 |
| 4 | The repository and the deployment | 272 of 280 |

Those counts are recomputed by the test below, so an edit that pushes a post over the limit is caught here rather
than in the compose box. The margin is thin on purpose: the text says as much as it can. If the counter in the
compose box disagrees, the counter is the authority — trim the prose, never the links or the hashtag.

## The order to publish in

Two links point at each other: this post carries the BUIDL link, and the BUIDL's *Links* table carries this post.
One of them has to come first.

1. Create the BUIDL page on DoraHacks from `docs/SUBMISSION.md` and copy its URL into `{{BUIDL_URL}}`.
2. Fill in `{{VIDEO_URL}}`, `{{REPO_URL}}` and `{{DEMO_URL}}` from the three human steps that produce them.
3. Publish post 1, then posts 2 to 4 as replies to it, in order.
4. Copy the URL of post 1 into the `X_POST_URL` placeholder of the submission text, and save the BUIDL.

If DoraHacks hands out no URL before a BUIDL is submitted, swap steps 3 and 4: submit first, publish the post, then
edit the BUIDL to add it. Either way, **nothing goes out carrying a `{{`**. Searching the compose box for two
opening braces is the last check before send, exactly as it is before pressing submit.

Submissions close on **2026-09-30, 23:59 UTC**, and step 4 happens after the post is live, so the post has to go
out with enough time left to paste its own URL back.

## If only one post goes out

Publish post 1. It carries the three things the rules ask for and stands alone. A post whose placeholder cannot be
filled in is dropped rather than published with a gap in it — if the Vercel deployment does not happen, post 4 goes
out without its last line, re-counted, or not at all.

## What keeps this text true

`tests/x-post-doc.test.ts` reads the four posts against the repository they describe. Every figure is recomputed:
the calibration share from `docs/calibration.json`, the number of audit entries from `docs/api_audit.json`, the
count of assets sharing the ticker by normalising the recorded `map` answer, the price of the one the ticker
resolves to from the recorded quote, and the refusal itself by replaying both orders through `preflight_trade`
offline. The verdict names come from the engine's own constants, the check count from `CHECK_IDS`, and the three
endpoint families from the paths the client may actually send. The counted length of each post is recomputed the
way X counts, the placeholders are declared once and used once, and the wording goes through the same tone gate as
the audit report. Nothing here is compared against a copy of itself.

What the test does not judge is whether the post is worth reading. That is the one thing a human has to decide
before pressing send.

## What is deliberately left out

- **No handle.** Tagging the organisers would help the post travel, but a handle this repository cannot verify is a
  handle that can point somewhere else entirely, and every other claim in these four posts is checked. Add it by hand
  if you want it, and re-count — a handle costs its own characters.
- **No image.** A screenshot would need alt text and a frame chosen by eye. The video is the visual.
- **No price talk and no call to buy anything.** The demonstration agent places no order, and the post says nothing
  a reader could mistake for advice.

---

### Post 1 — the one the rules ask for

```text
Agents act on prices they cannot verify.

Second Opinion is an MCP tool that cross-checks CoinMarketCap against itself and answers ACT, CAUTION or DO_NOT_ACT.

Told to buy tokenised gold, the demo agent refuses.

{{VIDEO_URL}} {{BUIDL_URL}}
#BuildwithCMC
```

### Post 2 — how it reads one source against another

```text
How: three CoinMarketCap endpoint families that do not derive from one another — aggregated quotes, DEX pools, the real-world-asset catalogue. Seven checks read one against another.

No verdict without evidence: every check names the answers it read.
```

### Post 3 — the order it refused

```text
The refused order: XAU is the ISO code for an ounce of gold, so it is the ticker the instruction reaches for. The CMC map returns four assets under it, and the one it resolves to is priced around 1e-11 USD.

Two independent readings stop the order.
```

### Post 4 — what it was measured against, and where the code is

```text
Calibrated before the demo: on the top 50 by market cap, 47 answer ACT — 94%. A tool that cries wolf on Bitcoin is no use before an order.

It also writes an API audit: 24 entries, each citing a recorded answer.

Code: {{REPO_URL}}
Live: {{DEMO_URL}}
```
