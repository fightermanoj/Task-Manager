/* One small request a day, so the free Supabase project does not fall asleep.
 *
 * Supabase pauses a free project after seven days with no activity. Nothing is
 * lost when it happens — the dashboard's "Resume project" brings it back exactly
 * as it was — but until someone notices, every sync in the app fails, and the
 * only clue is a status pill reading "Not synced". This app is a personal task
 * list: quiet weeks are normal, so without something poking it the project would
 * pause on a schedule and look like a bug.
 *
 * A scheduled job (a "cron") on Vercel calls this once a day. Vercel's free plan
 * allows exactly one run a day, which is all that is needed and all that is
 * allowed, and it is free on every plan. Cron jobs on Vercel are only ever
 * invoked on a production deployment, so this runs against the same project the
 * app itself talks to.
 *
 * Why a database query and not just a ping: Supabase counts requests to the
 * database. Asking the REST API for one row means the request travels through
 * their API layer and into Postgres, which is what activity means here. A plain
 * HEAD to the site root would not necessarily do it.
 *
 * Returning zero rows is the expected, healthy answer. The access rules let a
 * signed-in user see only their own tasks, and this request arrives as nobody in
 * particular — so the reply is an empty list. An empty list still means Postgres
 * ran the query and answered, and that is the whole point. Do not "fix" this by
 * loosening a policy to make rows come back.
 *
 * The two values below are copies of what is in config.js. They are duplicated
 * rather than imported because this file runs on the server, where the browser
 * globals config.js assigns to do not exist. Both are public by design — the
 * key says "this is the Task Manager app" and carries no permissions of its own;
 * the database rules are what protect your data. `tests/pwa-check.js` fails if
 * these ever drift from config.js, so the copy cannot silently go stale.
 */

const PROJECT_URL = 'https://dgavsfnnxaglfkrsjjqf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYXZzZm5ueGFnbGZrcnNqanFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTM5NjYsImV4cCI6MjEwNTY2OTk2Nn0.4Mu_dOfmFOUw25yoLZn-TTJOvqvdGWxLxzO9beSboDQ';

// Long enough for a cold database, short enough that a hung request does not sit
// there. Vercel kills the function eventually, but failing on our own terms
// gives a clearer log line.
const TIMEOUT_MS = 10000;

// One row, no columns of interest. The cheapest query that still reaches
// Postgres. `limit=1` keeps the response tiny even if the rules are ever wider
// than they are today.
const ENDPOINT = `${PROJECT_URL}/rest/v1/tasks?select=id&limit=1`;

// Vercel's cron issues a GET. A GET is also what happens when someone opens this
// URL in a browser to check on it by hand, which is the other reason it exists.
// Anything else is refused rather than quietly treated as a ping.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ ok: false, error: 'Only GET is allowed.' });
    return;
  }

  // Nobody should ever cache the answer to "did the ping work".
  res.setHeader('Cache-Control', 'no-store');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(ENDPOINT, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Accept: 'application/json'
      }
    });

    const took = Date.now() - startedAt;

    if (!response.ok) {
      // A paused project answers, but from Cloudflare rather than from Supabase:
      // 521 means "the name resolves and the origin refused the connection",
      // and a paused project is exactly an origin that is not running. This was
      // observed against the real paused project rather than guessed at, so it
      // is the common case, not a corner one — and it is worth naming, because
      // the raw body is a wall of Cloudflare support links that never mentions
      // Supabase, which is no help at all when you are trying to work out why
      // the app stopped syncing.
      if (response.status === 521 || response.status === 522 || response.status === 523) {
        res.status(502).json({
          ok: false,
          status: response.status,
          took,
          error: 'The Supabase project is not running — it has most likely been paused for inactivity.',
          hint: 'Open the Supabase dashboard, find the project, and press "Resume project". Nothing is lost when this happens.'
        });
        return;
      }
      // Anything else with a real status code is a rotated key (401) or a rate
      // limit (429). The body says which, and it is short.
      const body = await response.text().catch(() => '');
      res.status(502).json({
        ok: false,
        status: response.status,
        took,
        // Truncated: enough to recognise the error, not enough to dump a page.
        body: body.slice(0, 400),
        error: 'Supabase answered, but not with a success.'
      });
      return;
    }

    // A 200 from the API is enough on its own — the API cannot answer without
    // having queried the database. This is only here so a captive-portal or proxy
    // page that returns 200 with HTML is not mistaken for a healthy ping.
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data)) {
      res.status(502).json({ ok: false, took, error: 'Unexpected reply — not a row list.' });
      return;
    }

    res.status(200).json({ ok: true, took, rows: data.length, at: new Date().toISOString() });
  } catch (err) {
    const took = Date.now() - startedAt;
    // Reaching here means the request never got an answer at all, which is a
    // rarer case than it looks: a paused project still answers (see above). The
    // useful detail is buried a level down — the fetch throws a generic "fetch
    // failed" and the real reason is on `cause`. Surfacing it is the difference
    // between a log line that names the problem and one that does not.
    const code = (err && err.cause && err.cause.code) || (err && err.name);
    res.status(502).json({
      ok: false,
      took,
      reason: err && err.name === 'AbortError' ? `Timed out after ${TIMEOUT_MS}ms` : String(code || err),
      error: 'Could not reach the database.'
    });
  } finally {
    clearTimeout(timer);
  }
};
