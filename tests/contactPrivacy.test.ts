import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authed: vi.fn() }));
vi.mock("@/lib/apiAuth", () => ({ authed: mocks.authed }));
import { GET } from "@/app/api/account/access/route";

const ownerEmail = "moldovansandor1998@gmail.com";
const request = () => new NextRequest("http://localhost/api/account/access", { headers: { authorization: "Bearer fixture" } });
beforeEach(() => vi.clearAllMocks());

describe("company contact and owner identity privacy", () => {
  it("uses only the Fanvasia company address for payment support", () => {
    const page = readFileSync("src/app/(app)/plans/page.tsx", "utf8");
    expect(page).toContain('<a href="mailto:support@fanvasia.com">support@fanvasia.com</a>');
    expect(page).not.toContain(ownerEmail);
  });

  it("keeps the private owner predicate server-only and out of rendered source", () => {
    const guard = readFileSync("src/lib/security/internalAccess.ts", "utf8");
    expect(guard).toContain('import "server-only"');
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.(tsx?|jsx?)$/.test(path)) expect(readFileSync(path, "utf8"), path).not.toContain(ownerEmail);
      }
    };
    visit("src/app"); visit("src/components");
    const shell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(shell).not.toContain("security/internalAccess");
    expect(shell).toContain('setEmail(access ? "support@fanvasia.com"');
  });

  it.each([
    [ownerEmail, true],
    ["customer@example.com", false],
    ["support@fanvasia.com", false],
    [`${ownerEmail}.evil.example`, false],
  ])("returns only a private capability for %s", async (email, isOwner) => {
    mocks.authed.mockResolvedValue({ id: "fixture", email });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isOwner });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(mocks.authed).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated or banned callers without revealing identity", async () => {
    mocks.authed.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
