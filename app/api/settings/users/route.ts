/**
 * app/api/settings/users/route.ts
 *
 * GET /api/settings/users — list all user accounts (admin only).
 *
 * Read-only. listUsers() in the repository already omits passwordHash — this
 * route never sees or forwards it. Built so the admin has a simple grid instead
 * of needing direct SQL access to see who has an account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdmin } from '@/lib/auth/guard';
import { listUsers } from '@/lib/db/repository';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  try {
    const users = listUsers();
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        shareLogsWithAdmin: u.shareLogsWithAdmin,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('[settings/users] GET error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
