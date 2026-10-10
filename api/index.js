// Vercel entry point. vercel.json rewrites every /api, /apis, /admin and /health request to this
// function; the portal itself is served as static files from frontend/dist.
// Note: on Vercel the data lives in /tmp and is temporary (see README → Deploy → Vercel).
const { app, ready } = require('../server/src/index.js');

module.exports = async (req, res) => {
  await ready; // registry loaded (and SEED_APIS applied) once per function instance
  return app(req, res);
};
