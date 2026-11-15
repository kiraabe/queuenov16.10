import { afterEach, describe, expect, it, vi } from "vitest";
import { requireLicenseIssuer } from "../middleware/license-issuer";

describe("license issuer authorization", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests when issuer mode is disabled", () => {
    process.env.LICENSE_ISSUER_ENABLED = "false";
    process.env.LICENSE_SIGNING_KEY_ID = "test-key";
    process.env.LICENSE_SIGNING_PRIVATE_KEY = "not-present-in-sub-city-deployments";
    const next = vi.fn();
    const json = vi.fn();
    const response = { status: vi.fn(() => ({ json })) };

    requireLicenseIssuer({} as never, response as never, next);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows requests only when the issuer signing configuration is present", () => {
    process.env.LICENSE_ISSUER_ENABLED = "true";
    process.env.LICENSE_SIGNING_KEY_ID = "test-key";
    process.env.LICENSE_SIGNING_PRIVATE_KEY = "issuer-only-key";
    const next = vi.fn();
    requireLicenseIssuer({} as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
