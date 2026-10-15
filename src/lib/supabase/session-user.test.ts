import { describe, expect, it, vi } from "vitest";
import { getSessionUser } from "./session-user";

function client(result: unknown) {
  const getClaims = vi.fn().mockResolvedValue(result);
  return { client: { auth: { getClaims } } as never, getClaims };
}

describe("getSessionUser", () => {
  it("returns the id and e-mail from verified claims", async () => {
    const { client: c, getClaims } = client({ data: { claims: { sub: "u1", email: "ana@example.com" } }, error: null });
    expect(await getSessionUser(c)).toEqual({ id: "u1", email: "ana@example.com" });
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("returns null without a session", async () => {
    expect(await getSessionUser(client({ data: null, error: null }).client)).toBeNull();
  });

  it("returns null when the token does not verify", async () => {
    const res = { data: null, error: { name: "AuthInvalidJwtError", message: "Invalid JWT signature" } };
    expect(await getSessionUser(client(res).client)).toBeNull();
  });

  it("tolerates a token without e-mail", async () => {
    expect(await getSessionUser(client({ data: { claims: { sub: "u1" } }, error: null }).client)).toEqual({ id: "u1", email: null });
  });
});
