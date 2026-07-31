/**
 * app/api/settings/route.ts
 *
 * GET  /api/settings  — returns all known settings with defaults applied (admin only)
 * PATCH /api/settings — upserts one setting (allowlisted by SETTING_DEFS) (admin only)
 *
 * Design (§7.1, §8 policies 10–11):
 *   - GET returns one entry per SETTING_DEFS key, whether or not a DB row exists.
 *     isDefault=true means no row exists; the default value from SETTING_DEFS is shown.
 *   - PATCH is allowlisted: only keys in SETTING_DEFS may be written.
 *     Values are validated against the key's datatype before storage.
 *   - Coerces the incoming value to a string before storage (setting table stores text).
 */

import { NextRequest, NextResponse } from 'next/server';
import { SETTING_DEFS, parseSettingValue } from '@/lib/settings';
import { getAllSettings, setSetting } from '@/lib/db/repository';
import { authenticateAdmin } from '@/lib/auth/guard';

// ── GET /api/settings ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  try {
    const rows = getAllSettings();
    const rowMap = new Map(rows.map((r) => [r.key, r]));

    const settings = SETTING_DEFS.map((def) => {
      const row = rowMap.get(def.key);
      if (row) {
        const parsed = parseSettingValue(row.value, def.datatype);
        return {
          key: def.key,
          label: def.label,
          hint: def.hint,
          datatype: def.datatype,
          value: parsed ?? def.default,
          isDefault: false,
          updatedAt: row.updatedAt.toISOString(),
        };
      }
      return {
        key: def.key,
        label: def.label,
        hint: def.hint,
        datatype: def.datatype,
        value: def.default,
        isDefault: true,
        updatedAt: null,
      };
    });

    return NextResponse.json({ settings }, { status: 200 });
  } catch (err) {
    console.error('[settings] GET unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

// ── PATCH /api/settings ────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateAdmin(request.nextUrl.pathname);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { key, value } = body as Record<string, unknown>;

  if (typeof key !== 'string') {
    return NextResponse.json({ error: 'invalid_body', field: 'key' }, { status: 400 });
  }

  // Allowlist: only SETTING_DEFS keys are writable
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) {
    return NextResponse.json({ error: 'unknown_setting_key', key }, { status: 400 });
  }

  // Validate and coerce value to string for storage
  let rawValue: string;
  if (def.datatype === 'bool') {
    if (typeof value !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid_setting_value', key, datatype: def.datatype },
        { status: 400 },
      );
    }
    rawValue = value ? 'true' : 'false';
  } else if (def.datatype === 'int') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return NextResponse.json(
        { error: 'invalid_setting_value', key, datatype: def.datatype },
        { status: 400 },
      );
    }
    if (def.min !== undefined && value < def.min) {
      return NextResponse.json(
        { error: 'invalid_setting_value', key, datatype: def.datatype, min: def.min },
        { status: 400 },
      );
    }
    if (def.max !== undefined && value > def.max) {
      return NextResponse.json(
        { error: 'invalid_setting_value', key, datatype: def.datatype, max: def.max },
        { status: 400 },
      );
    }
    rawValue = String(value);
  } else {
    // string
    if (typeof value !== 'string') {
      return NextResponse.json(
        { error: 'invalid_setting_value', key, datatype: def.datatype },
        { status: 400 },
      );
    }
    rawValue = value;
  }

  try {
    const row = setSetting(key, rawValue);
    const parsed = parseSettingValue(rawValue, def.datatype);
    return NextResponse.json(
      {
        key,
        value: parsed ?? def.default,
        isDefault: false,
        updatedAt: row.updatedAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[settings] PATCH unexpected error:', String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
