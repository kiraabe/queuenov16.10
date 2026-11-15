import crypto from "node:crypto";
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
    const pair = crypto.generateKeyPairSync("ed25519");
    process.env.LICENSE_ISSUER_ENABLED = "true";
    process.env.LICENSE_SIGNING_KEY_ID = "test-key";
    process.env.LICENSE_SIGNING_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.LICENSE_TRUSTED_PUBLIC_KEYS = JSON.stringify({ "test-key": pair.publicKey.export({ type: "spki", format: "pem" }).toString() });
    const next = vi.fn();
    requireLicenseIssuer({} as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
