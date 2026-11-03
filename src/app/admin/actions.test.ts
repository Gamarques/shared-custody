import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions of /admin with a fake supabase server client.
let admin = true;
let rpcError: { code: string } | null = null;
const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
let files: string[] = [];
let removeFails = false;
const list = vi.fn(async (path: string, { limit }: { limit: number }) => ({
  data: files.slice(0, limit).map((f) => ({ name: f, id: `${path}/${f}` })),
  error: null,
}));
const remove = vi.fn(async (paths: string[]) => {
  if (removeFails) return { data: null, error: { message: "denied" } };
  files = files.filter((f) => !paths.some((p) => p.endsWith(`/${f}`)));
  return { data: paths, error: null };
});
const bucket = vi.fn(() => ({ list, remove }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, storage: { from: bucket } }) }));
vi.mock("@/lib/auth/admin", () => ({ isAppAdmin: async () => admin }));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { deleteFamilyAction, removeMemberAction } from "./actions";

const FAMILY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  admin = true;
  rpcError = null;
  files = [];
  removeFails = false;
  vi.clearAllMocks();
});

describe("removeMemberAction", () => {
  it("calls admin_remove_member with the caller's session and refreshes", async () => {
    expect(await removeMemberAction(FAMILY, USER)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_remove_member", { p_family_id: FAMILY, p_user_id: USER });
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses non-admins and malformed ids before reaching the database", async () => {
    admin = false;
    expect(await removeMemberAction(FAMILY, USER)).toEqual({ ok: false, error: expect.stringContaining("permissões") });
    admin = true;
    expect((await removeMemberAction("x", USER)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors to messages", async () => {
    rpcError = { code: "AD001" };
    expect(await removeMemberAction(FAMILY, USER)).toEqual({ ok: false, error: expect.stringContaining("elimina a família") });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("deleteFamilyAction", () => {
  it("deletes the family, then removes its receipt files through Storage", async () => {
    files = ["a.jpg", "b.jpg"];
    expect(await deleteFamilyAction(FAMILY)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_delete_family", { p_family_id: FAMILY });
    expect(bucket).toHaveBeenCalledWith("receipts");
    expect(remove).toHaveBeenCalledWith([`${FAMILY}/a.jpg`, `${FAMILY}/b.jpg`]);
    expect(files).toEqual([]);
    expect(refresh).toHaveBeenCalled();
  });

  it("touches no file when the database refuses", async () => {
    rpcError = { code: "42501" };
    files = ["a.jpg"];
    expect((await deleteFamilyAction(FAMILY)).ok).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(files).toEqual(["a.jpg"]);
  });

  it("tells the admin when receipt files could not be removed", async () => {
    files = ["a.jpg"];
    removeFails = true;
    await expect(deleteFamilyAction(FAMILY)).rejects.toThrow(`redirect:/admin?aviso=recibos&familia=${FAMILY}`);
  });

  it("refuses non-admins", async () => {
    admin = false;
    expect((await deleteFamilyAction(FAMILY)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
