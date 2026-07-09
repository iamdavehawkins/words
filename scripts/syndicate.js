#!/usr/bin/env node
/* ============================================================
   POSSE syndication: cross-post NEW writing to Bluesky + Mastodon.

   - Reads the built manifest (_site/syndication.json).
   - State lives in _syndicated.json at the repo root:
       { "<canonical url>": { "bluesky": true, "mastodon": true } }
   - FIRST RUN (no state file): seed everything as already-done and
     post nothing, so the existing backlog is never blasted out.
   - Each post links back to the canonical copy on the site.
   - Platforms with missing secrets are skipped. A failure on one
     post is logged and does not fail the build.

   Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD,
        MASTODON_INSTANCE, MASTODON_TOKEN, DRY_RUN(optional)
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "_site", "syndication.json");
const STATE = path.join(ROOT, "_syndicated.json");
const DRY = !!process.env.DRY_RUN;

const BSKY_HANDLE = process.env.BLUESKY_HANDLE;
const BSKY_PASS = process.env.BLUESKY_APP_PASSWORD;
const MASTO_INSTANCE = (process.env.MASTODON_INSTANCE || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const MASTO_TOKEN = process.env.MASTODON_TOKEN;

const BSKY_LIMIT = 300;
const MASTO_LIMIT = 500;

function composeText(item, limit) {
  const body = (item.isNote ? item.text : item.title) || item.text || "";
  const url = item.url;
  const tail = "\n\n" + url;
  let text = body;
  if ((text + tail).length > limit) {
    text = body.slice(0, Math.max(0, limit - tail.length - 1)).trim() + "…";
  }
  return { text: text + tail, url, urlStart: (text + "\n\n").length };
}

async function postBluesky(item) {
  const { text, url } = composeText(item, BSKY_LIMIT);
  // link facet (byte offsets) so the url is clickable
  const before = text.slice(0, text.length - url.length);
  const byteStart = Buffer.byteLength(before, "utf8");
  const byteEnd = byteStart + Buffer.byteLength(url, "utf8");

  const sess = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_PASS }),
  }).then((r) => r.json());
  if (!sess.accessJwt) throw new Error("bluesky auth failed: " + JSON.stringify(sess));

  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    facets: [
      { index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] },
    ],
  };
  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + sess.accessJwt },
    body: JSON.stringify({ repo: sess.did, collection: "app.bsky.feed.post", record }),
  }).then((r) => r.json());
  if (!res.uri) throw new Error("bluesky post failed: " + JSON.stringify(res));
}

async function postMastodon(item) {
  const { text } = composeText(item, MASTO_LIMIT);
  const res = await fetch(`https://${MASTO_INSTANCE}/api/v1/statuses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + MASTO_TOKEN },
    body: JSON.stringify({ status: text }),
  }).then((r) => r.json());
  if (!res.id) throw new Error("mastodon post failed: " + JSON.stringify(res));
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error("no manifest at " + MANIFEST + " (build first)");
    process.exit(0);
  }
  const items = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // First run: seed everything as done, post nothing.
  if (!fs.existsSync(STATE)) {
    const seed = {};
    for (const it of items) seed[it.id] = { bluesky: true, mastodon: true };
    fs.writeFileSync(STATE, JSON.stringify(seed, null, 2) + "\n");
    console.log(`seeded ${items.length} existing posts as already-syndicated (no posts sent).`);
    return;
  }

  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const bskyOn = !!(BSKY_HANDLE && BSKY_PASS);
  const mastoOn = !!(MASTO_INSTANCE && MASTO_TOKEN);
  let changed = false;

  for (const it of items) {
    const done = state[it.id] || {};
    if (bskyOn && !done.bluesky) {
      try {
        if (!DRY) await postBluesky(it); else console.log("[dry] bluesky <-", it.id);
        done.bluesky = true; changed = true; console.log("bluesky posted:", it.id);
      } catch (e) { console.error("bluesky error:", it.id, e.message); }
    }
    if (mastoOn && !done.mastodon) {
      try {
        if (!DRY) await postMastodon(it); else console.log("[dry] mastodon <-", it.id);
        done.mastodon = true; changed = true; console.log("mastodon posted:", it.id);
      } catch (e) { console.error("mastodon error:", it.id, e.message); }
    }
    state[it.id] = done;
  }

  if (changed) {
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
    console.log("updated _syndicated.json");
  } else {
    console.log("nothing new to syndicate.");
  }
}

main().catch((e) => { console.error(e); process.exit(0); });
