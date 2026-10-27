import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    if (secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters long for security.");
    }
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production.");
  }
  if (!globalThis.__scribeDevJwtSecret) {
    globalThis.__scribeDevJwtSecret = crypto.randomBytes(32).toString("hex");
  }
  return globalThis.__scribeDevJwtSecret;
}

const JWT_SECRET = resolveJwtSecret();
const TOKEN_EXPIRY = "7d";

/**
 * Hashes a plaintext password with salt.
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

/**
 * Compares plaintext password against hashed password.
 */
export async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Generates signed JWT token for user.
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// Precomputed bcrypt hash to mitigate timing attacks against non-existent accounts
const DUMMY_HASH = "$2a$10$7EqJtq98hPqEX7fNZaFWoO.8/k.4YhL8e5vS/qjV6d1WnKzD3n4ey";

/**
 * Extracts and verifies token from Authorization header.
 */
export function authMiddleware(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }

  next();
}

/**
 * Middleware requiring authenticated user.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required for this operation." });
  }
  next();
}

/* ──────────────── Auth Controller Handlers ──────────────── */

export async function handleRegister(req, res) {
  try {
    const { username, email, password } = req.body || {};

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email address is required." });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (await db.findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    if (await db.findUserByUsername(cleanUsername)) {
      return res.status(409).json({ error: "This username is already taken." });
    }

    const passwordHash = await hashPassword(password);

    // Repeat uniqueness checks before insert to prevent concurrent registration race condition
    if (await db.findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    if (await db.findUserByUsername(cleanUsername)) {
      return res.status(409).json({ error: "This username is already taken." });
    }

    const userId = "usr_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);

    const user = await db.createUser({
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
    });

    const token = generateToken(user);
    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email },
      token,
    });
  } catch (err) {
    console.error("[Auth Register Error]:", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
}

export async function handleLogin(req, res) {
  try {
    const { identifier, password } = req.body || {};

    if (
      typeof identifier !== "string" ||
      typeof password !== "string" ||
      !identifier.trim() ||
      !password
    ) {
      return res.status(400).json({ error: "Identifier (email or username) and password are required." });
    }

    const cleanId = identifier.trim();
    const user = (await db.findUserByEmail(cleanId)) || (await db.findUserByUsername(cleanId));

    if (!user) {
      await comparePassword(password, DUMMY_HASH);
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = generateToken(user);
    res.json({
      user: { id: user.id, username: user.username, email: user.email },
      token,
    });
  } catch (err) {
    console.error("[Auth Login Error]:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
}

export async function handleGetMe(req, res) {
  if (!req.user) {
    return res.json({ guest: true });
  }

  const user = await db.findUserById(req.user.id);
  if (!user) {
    return res.json({ guest: true });
  }

  res.json({
    guest: false,
    user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt },
  });
}
