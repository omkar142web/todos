// Vercel serverless entrypoint: the platform invokes the exported
// Express app per request (no app.listen on serverless).
const app = require("../server/index");

module.exports = app;
