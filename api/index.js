const { app, ready } = require('../server/src/index.js');

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
  await ready;
  stripRewriteParams(req);
  return app(req, res);
};
