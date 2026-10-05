import { Router } from "express";
import {
  DUMMY_PASSWORD_HASH,
  clearSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  readSessionToken,
  setSessionCookie,
  verifyPassword,
  businessForToken,
} from "../auth";
import { store } from "../store";
import { limit } from "../rateLimit";
import { ApiError, email, text } from "../validate";
import { publicBusiness } from "../views";

export const authRouter = Router();

authRouter.post("/signup", limit("signup", 5, 60_000), async (req, res) => {
  const name = text(req.body?.businessName, { label: "Business name", min: 2, max: 80 });
  const ownerName = text(req.body?.ownerName, { label: "Your name", min: 2, max: 80 });
  const emailAddress = email(req.body?.email);
  const password = text(req.body?.password, { label: "Password", min: 8, max: 128 });

  let business;
  try {
    business = await store.createBusiness({ name, ownerName, email: emailAddress, passwordHash: hashPassword(password) });
  } catch (err) {
    if (err instanceof Error && err.message.includes("email")) {
      throw new ApiError(409, "An account with this email already exists. Try signing in instead.");
    }
    throw err;
  }

  const { token, expiresAt } = await createSession(business.id);
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ ok: true, business: publicBusiness(business) });
});

authRouter.post("/login", limit("login", 15, 300_000), async (req, res) => {
  const emailAddress = email(req.body?.email);
  const password = req.body?.password;
  if (typeof password !== "string" || password.length === 0) {
    throw new ApiError(400, "Enter your password.");
  }

  const business = await store.getBusinessByEmail(emailAddress);
  if (!business) {
    verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new ApiError(401, "Wrong email or password.");
  }
  if (!verifyPassword(password, business.password_hash)) {
    throw new ApiError(401, "Wrong email or password.");
  }

  const { token, expiresAt } = await createSession(business.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ ok: true, business: publicBusiness(business) });
});

authRouter.get("/me", async (req, res) => {
  const token = readSessionToken(req);
  const business = token ? await businessForToken(token) : null;
  res.json({ ok: true, business: business ? publicBusiness(business) : null });
});

authRouter.post("/logout", async (req, res) => {
  const token = readSessionToken(req);
  if (token) await deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});
