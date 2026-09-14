const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

function getJwtSecret() {
  return (
    process.env.JWT_SECRET || "dev-only-secret-change-me-in-production-please"
  );
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    },
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing token" });
  }
  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.userId = payload.sub;
    // Backward compat: tokens issued before username migration carry `email`.
    req.username = payload.username || payload.email || null;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

module.exports = {
  signToken,
  requireAuth,
  hashPassword,
  verifyPassword,
  newId,
  normalizeUsername,
  isValidUsername,
};
