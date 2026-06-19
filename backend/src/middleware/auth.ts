import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { PrismaClient, User } from "@prisma/client";
import {
  canAccessPage,
  canWrite,
  canEditPo,
  canAdvanceStage,
  canManageUsers,
  type Page,
} from "../constants.js";

export const prisma = new PrismaClient();

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  accessLevel: string;
  restrictedPages: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
}

export function signToken(user: User): string {
  const payload: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accessLevel: user.accessLevel,
    restrictedPages: user.restrictedPages,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accessLevel: user.accessLevel,
    restrictedPages: user.restrictedPages,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid or inactive user" });
    }
    req.user = toAuthUser(user);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requirePage(page: Page) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!canAccessPage(req.user.role, req.user.accessLevel, req.user.restrictedPages, page)) {
      return res.status(403).json({ error: `Access denied to ${page}` });
    }
    next();
  };
}

export function requireWrite(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!canWrite(req.user.role, req.user.accessLevel)) {
    return res.status(403).json({ error: "Maintainer access required" });
  }
  next();
}

export function requirePoEdit(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!canEditPo(req.user.role)) {
    return res.status(403).json({ error: "Maintainer access required to edit POs" });
  }
  next();
}

export function requireStageAdvance(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const nextStage = String(req.body?.nextStage ?? "");
  if (!nextStage || !canAdvanceStage(req.user.role, nextStage)) {
    return res.status(403).json({ error: `Cannot advance to ${nextStage || "stage"}` });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!canManageUsers(req.user.role)) {
    return res.status(403).json({ error: "Super admin access required" });
  }
  next();
}
