import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore } from "@/lib/demo/server";
import { POST } from "./route";
import { GET } from "./receipt/route";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

function post(body: unknown) {
  return POST(new Request("http://localhost/api/demo", { method: "POST", body: JSON.stringify(body) }));
}

describe("/api/demo", () => {
  it("does not exist outside demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    expect((await post({ kind: "rpc", fn: "keepalive_ping", args: {} })).status).toBe(404);
    expect(GET(new NextRequest("http://localhost/api/demo/receipt?path=x")).status).toBe(404);
  });

  it("runs requests on the shared in-memory store as Ana", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const store = resetDemoStore();
    const familyId = store.tables.families[0].id;
    const res = await post({ kind: "rpc", fn: "create_invite", args: {} });
    expect((await res.json()).error.code).toBe("IV005");
    const rows = await (
      await post({ kind: "table", table: "children", action: "select", columns: "name", filters: [{ column: "family_id", op: "eq", value: familyId }], order: [] })
    ).json();
    expect(rows.data).toEqual([{ name: "Leonor" }]);
  });

  it("serves uploaded receipts and 404s unknown ones", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const store = resetDemoStore();
    const path = `${String(store.tables.families[0].id)}/r.jpg`;
    await post({ kind: "storage", op: "upload", bucket: "receipts", path, base64: "/9j/2Q==", contentType: "image/jpeg", upsert: false });
    const ok = GET(new NextRequest(`http://localhost/api/demo/receipt?path=${encodeURIComponent(path)}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(GET(new NextRequest("http://localhost/api/demo/receipt?path=nope")).status).toBe(404);
  });
});
