import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, sqlState, type TestDb } from "@/test/pg";

// Invite-only sign-up (migration 20261107000100_invite_only_signup.sql) on PGlite with every
// migration applied: claim_invite (called by the login page as anon) and the Supabase Auth
// "Before User Created" hook (called by Supabase Auth as supabase_auth_admin).

let t: TestDb;
let ana: string;
let familyId: string;

const REJECT = { error: { http_code: 403, message: "signup_requires_invite" } };

async function createInvite(email: string | null = null): Promise<string> {
  return t.as(ana, async () => {
    const { rows } = await t.db.query<{ token: string }>("select token from create_invite($1)", [email]);
    return rows[0].token;
  });
}

/** claim_invite as anon (no session), as the login page calls it. */
function claim(token: string, email: string | null) {
  return t.as(null, () => t.db.query("select claim_invite($1, $2)", [token, email]));
}

async function invite(token: string) {
  const { rows } = await t.db.query<{ claimed_email: string | null; claimed_at: string | null; claim_count: number }>(
    "select claimed_email, claimed_at, claim_count from invites where token = $1",
    [token],
  );
  return rows[0];
}

function userEvent(email: unknown) {
  return {
    metadata: {
      uuid: "8b34dcdd-9df1-4c10-850a-b3277c653040",
      time: "2026-11-07T10:00:00Z",
      name: "before-user-created",
      ip_address: "127.0.0.1",
    },
    user: {
      id: "ff7fc9ae-3b1b-4642-9241-64adb9848a03",
      aud: "authenticated",
      role: "",
      email,
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "0001-01-01T00:00:00Z",
      updated_at: "0001-01-01T00:00:00Z",
      is_anonymous: false,
    },
  };
}

/** Runs the hook the way Supabase Auth does: as supabase_auth_admin. */
async function hook(event: unknown): Promise<unknown> {
  await t.db.exec("set role supabase_auth_admin");
  try {
    const { rows } = await t.db.query<{ r: unknown }>("select shared_custody.hook_before_user_created($1::jsonb) as r", [
      JSON.stringify(event),
    ]);
    return rows[0].r;
  } finally {
    await t.db.exec("reset role");
  }
}

beforeEach(async () => {
  t = await createTestDb();
  ana = await t.createUser("ana@example.com");
  familyId = await t.as(ana, async () => {
    const { rows } = await t.db.query<{ id: string }>("select create_family('Família Silva', 'Ana', '#2f6f5e') as id");
    return rows[0].id;
  });
}, 30_000);

describe("claim_invite", () => {
  it("anon claims a pending invite: the trimmed, lowercased e-mail is stored with the time", async () => {
    const token = await createInvite();
    expect(await sqlState(claim(token, "  Bruno@Example.COM "))).toBeNull();
    const row = await invite(token);
    expect(row.claimed_email).toBe("bruno@example.com");
    expect(row.claimed_at).not.toBeNull();
    // A later claim with another e-mail overwrites (the token is the secret).
    await claim(token, "carla@example.com");
    expect((await invite(token)).claimed_email).toBe("carla@example.com");
  });

  it("refuses an unknown token (IV001)", async () => {
    await createInvite();
    expect(await sqlState(claim("f".repeat(64), "bruno@example.com"))).toBe("IV001");
  });

  it("refuses a used invite (IV002)", async () => {
    const token = await createInvite();
    const bruno = await t.createUser("bruno@example.com");
    await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
    expect(await sqlState(claim(token, "carla@example.com"))).toBe("IV002");
  });

  it("refuses an expired invite (IV003)", async () => {
    const token = await createInvite();
    await t.db.query("update invites set expires_at = now() - interval '1 second' where token = $1", [token]);
    expect(await sqlState(claim(token, "bruno@example.com"))).toBe("IV003");
    expect((await invite(token)).claimed_email).toBeNull();
  });

  it("refuses an e-mail other than the invite's e-mail lock (IV004), accepts the locked one in any case", async () => {
    const token = await createInvite("bruno@example.com");
    expect(await sqlState(claim(token, "carla@example.com"))).toBe("IV004");
    expect((await invite(token)).claimed_email).toBeNull();
    expect(await sqlState(claim(token, " BRUNO@example.com"))).toBeNull();
    expect((await invite(token)).claimed_email).toBe("bruno@example.com");
  });

  it("refuses an invalid e-mail (IV009)", async () => {
    const token = await createInvite();
    for (const bad of [null, "", "   ", "bruno", "bruno@example", "a b@example.com", "@example.com"]) {
      expect(await sqlState(claim(token, bad)), String(bad)).toBe("IV009");
    }
    expect((await invite(token)).claimed_email).toBeNull();
  });

  it("refuses an invite of a family that is already full (IV005)", async () => {
    const token = await createInvite();
    const bruno = await t.createUser("bruno@example.com");
    await t.db.query("insert into members (family_id, user_id, display_name, color, role) values ($1, $2, 'Bruno', '#1d4ed8', 'member')", [
      familyId,
      bruno,
    ]);
    expect(await sqlState(claim(token, "carla@example.com"))).toBe("IV005");
  });

  it("allows 5 claims per invite in 10 minutes, refuses the 6th (IV010), and allows again after the window", async () => {
    const token = await createInvite();
    for (let i = 1; i <= 5; i++) expect(await sqlState(claim(token, `p${i}@example.com`)), `claim ${i}`).toBeNull();
    expect(await sqlState(claim(token, "p6@example.com"))).toBe("IV010");
    expect((await invite(token)).claimed_email).toBe("p5@example.com");
    await t.db.query("update invites set claim_window_start = now() - interval '11 minutes' where token = $1", [token]);
    expect(await sqlState(claim(token, "p7@example.com"))).toBeNull();
    expect(await invite(token)).toMatchObject({ claimed_email: "p7@example.com", claim_count: 1 });
  });

  it("is executable by anon and authenticated", async () => {
    const { rows } = await t.db.query<{ anon: boolean; auth: boolean }>(`
      select has_function_privilege('anon', 'shared_custody.claim_invite(text, text)', 'execute') as anon,
             has_function_privilege('authenticated', 'shared_custody.claim_invite(text, text)', 'execute') as auth`);
    expect(rows[0]).toEqual({ anon: true, auth: true });
  });

  it("the e-mail columns keep the same format check as invites.email", async () => {
    const token = await createInvite();
    expect(await sqlState(t.db.query("update invites set claimed_email = 'Upper@Example.com' where token = $1", [token]))).toBe("23514");
    expect(await sqlState(t.db.query("update invites set claimed_email = 'not-an-email' where token = $1", [token]))).toBe("23514");
  });
});

describe("hook_before_user_created", () => {
  it("allows the e-mail claimed on a pending invite (any case)", async () => {
    const token = await createInvite();
    await claim(token, "bruno@example.com");
    expect(await hook(userEvent("bruno@example.com"))).toEqual({});
    expect(await hook(userEvent(" Bruno@Example.com "))).toEqual({});
  });

  it("allows the e-mail lock of a pending invite, without a claim", async () => {
    await createInvite("bruno@example.com");
    expect(await hook(userEvent("BRUNO@example.com"))).toEqual({});
  });

  it("rejects a random e-mail with the documented error object", async () => {
    const token = await createInvite("bruno@example.com");
    await claim(token, "bruno@example.com");
    expect(await hook(userEvent("intruso@example.com"))).toEqual(REJECT);
  });

  it("rejects a claim older than 1 hour", async () => {
    const token = await createInvite();
    await claim(token, "bruno@example.com");
    await t.db.query("update invites set claimed_at = now() - interval '61 minutes' where token = $1", [token]);
    expect(await hook(userEvent("bruno@example.com"))).toEqual(REJECT);
    await t.db.query("update invites set claimed_at = now() - interval '59 minutes' where token = $1", [token]);
    expect(await hook(userEvent("bruno@example.com"))).toEqual({});
  });

  it("rejects once the invite was accepted", async () => {
    const token = await createInvite("bruno@example.com");
    await claim(token, "bruno@example.com");
    const bruno = await t.createUser("bruno@example.com");
    await t.as(bruno, () => t.db.query("select accept_invite($1, 'Bruno', '#1d4ed8')", [token]));
    expect(await hook(userEvent("bruno@example.com"))).toEqual(REJECT);
  });

  it("rejects once the invite expired (claimed and e-mail-locked)", async () => {
    const token = await createInvite("bruno@example.com");
    await claim(token, "bruno@example.com");
    await t.db.query("update invites set expires_at = now() - interval '1 second' where token = $1", [token]);
    expect(await hook(userEvent("bruno@example.com"))).toEqual(REJECT);
  });

  it("rejects when there is no invite at all", async () => {
    expect(await hook(userEvent("ana2@example.com"))).toEqual(REJECT);
  });

  it("never throws on unexpected input: returns the error object", async () => {
    const token = await createInvite();
    await claim(token, "bruno@example.com");
    for (const event of [{}, [], "x", 42, null, { user: null }, { user: "bruno@example.com" }, { user: {} }, userEvent(null), userEvent(""), userEvent(7), userEvent({ a: 1 })]) {
      expect(await hook(event), JSON.stringify(event)).toEqual(REJECT);
    }
    // SQL NULL, not JSON null.
    await t.db.exec("set role supabase_auth_admin");
    try {
      const { rows } = await t.db.query<{ r: unknown }>("select shared_custody.hook_before_user_created(null) as r");
      expect(rows[0].r).toEqual(REJECT);
    } finally {
      await t.db.exec("reset role");
    }
  });

  it("is executable only by supabase_auth_admin (not anon, authenticated or public)", async () => {
    const { rows } = await t.db.query<{ role: string; can: boolean }>(`
      select r as role, has_function_privilege(r, 'shared_custody.hook_before_user_created(jsonb)', 'execute') as can
      from unnest(array['anon', 'authenticated', 'supabase_auth_admin']) r order by r`);
    expect(rows).toEqual([
      { role: "anon", can: false },
      { role: "authenticated", can: false },
      { role: "supabase_auth_admin", can: true },
    ]);
    const { rows: acl } = await t.db.query<{ acl: string }>(
      "select proacl::text as acl from pg_proc where oid = 'shared_custody.hook_before_user_created(jsonb)'::regprocedure",
    );
    expect(acl[0].acl).not.toMatch(/(^|[{,])=X/); // no PUBLIC execute
    expect(await sqlState(t.as(null, () => t.db.query("select shared_custody.hook_before_user_created('{}'::jsonb)")))).toBe("42501");
    expect(await sqlState(t.as(ana, () => t.db.query("select shared_custody.hook_before_user_created('{}'::jsonb)")))).toBe("42501");
    const { rows: usage } = await t.db.query<{ ok: boolean }>("select has_schema_privilege('supabase_auth_admin', 'shared_custody', 'usage') as ok");
    expect(usage[0].ok).toBe(true);
  });
});
