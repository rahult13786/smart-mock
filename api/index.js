// Vercel entry point. vercel.json rewrites every /api, /apis, /admin and /health request to this
// function; the portal itself is served as static files from frontend/dist.
// Note: on Vercel the data lives in /tmp and is temporary (see README → Deploy → Vercel).
const { app, ready } = require('../server/src/index.js');

/**
 * Vercel can append the parts matched by a rewrite to the query string (e.g. "path=agreement/v1" or
 * "1=agreement/v1"). They are not real query parameters – the API would treat them as filters – so any
 * parameter whose value is exactly the rest of the URL path after /api, /apis or /admin is removed.
 */
function stripRewriteParams(req) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/(api|apis|admin)\/(.*)$/);
  if (!m) return;
  const rest = decodeURIComponent(m[2]).replace(/\/+$/, '');
  const prefix = m[1];
  let changed = false;
  for (const [k, v] of [...url.searchParams.entries()]) {
    const val = v.replace(/\/+$/, '');
    if (val === rest || val === prefix || val === `${prefix}/${rest}`) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  if (changed) req.url = url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '');
}

module.exports = async (req, res) => {
  await ready; // registry loaded (and SEED_APIS applied) once per function instance
  stripRewriteParams(req);
  return app(req, res);
};
