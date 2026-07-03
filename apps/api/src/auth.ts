/**
 * Operator authentication. Passwords are Argon2id; sessions are short-lived JWTs
 * carrying the operator's id, email, and role. The role drives maker-checker
 * authorisation (only a checker may approve refunds, and never their own).
 */
import { operators, type Db } from "@kobo/db";
import type { OperatorRole } from "@kobo/shared";
import argon2 from "argon2";
import { eq } from "drizzle-orm";

export interface OperatorClaims {
  sub: string;
  email: string;
  role: OperatorRole;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: OperatorClaims;
    user: OperatorClaims;
  }
}

export async function verifyOperator(
  db: Db,
  email: string,
  password: string,
): Promise<OperatorClaims | null> {
  const [op] = await db.select().from(operators).where(eq(operators.email, email)).limit(1);
  if (!op) return null;
  const ok = await argon2.verify(op.passwordHash, password);
  if (!ok) return null;
  return { sub: op.id, email: op.email, role: op.role };
}
