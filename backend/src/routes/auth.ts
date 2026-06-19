import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, requireAuth, requireSuperAdmin, signToken, toAuthUser } from "../middleware/auth.js";
import { PAGES, ROLE_LABELS, ASSIGNABLE_ROLES, accessLevelForRole } from "../constants.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password format" });
  }
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken(user);
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, user: toAuthUser(user) });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: toAuthUser(user) });
});

router.get("/roles", requireAuth, (_req, res) => {
  res.json({
    roles: ASSIGNABLE_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
    pages: PAGES,
  });
});

const assignableRole = z.enum(["MAINTAINER", "MANAGER", "FINANCE", "LOGISTICS", "SUPERVISOR", "VIEWER"]);

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: assignableRole,
  restrictedPages: z.array(z.string()).default([]),
});

router.get("/users", requireAuth, requireSuperAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { not: "SUPER_ADMIN" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      accessLevel: true,
      restrictedPages: true,
      isActive: true,
      createdAt: true,
    },
  });
  res.json({ users });
});

router.post("/users", requireAuth, requireSuperAdmin, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
      accessLevel: accessLevelForRole(data.role),
      restrictedPages: data.restrictedPages,
      createdById: req.user!.id,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      accessLevel: true,
      restrictedPages: true,
      isActive: true,
      createdAt: true,
    },
  });
  res.status(201).json({ user });
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: assignableRole.optional(),
  restrictedPages: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "SUPER_ADMIN") {
    return res.status(403).json({ error: "Cannot modify super admin" });
  }
  const data = parsed.data;
  if (data.email) {
    const dup = await prisma.user.findFirst({
      where: { email: data.email.toLowerCase(), NOT: { id: target.id } },
    });
    if (dup) return res.status(409).json({ error: "Email already in use" });
  }
  const update: Record<string, unknown> = { ...data };
  if (data.email) update.email = data.email.toLowerCase();
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);
  if (data.role) update.accessLevel = accessLevelForRole(data.role);
  delete update.password;

  const user = await prisma.user.update({
    where: { id: target.id },
    data: update,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      accessLevel: true,
      restrictedPages: true,
      isActive: true,
      createdAt: true,
    },
  });
  res.json({ user });
});

router.delete("/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "SUPER_ADMIN") {
    return res.status(403).json({ error: "Cannot delete super admin" });
  }
  await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
  res.json({ ok: true });
});

export default router;
