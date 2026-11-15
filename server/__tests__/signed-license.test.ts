import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateDir: string;
let originalEnv: NodeJS.ProcessEnv;
let signedLicense: typeof import("../services/signed-license");

beforeEach(async () => {
  originalEnv = { ...process.env };
  stateDir = await mkdtemp(path.join(os.tmpdir(), "stc-license-test-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  process.env.LICENSE_STATE_DIR = stateDir;
  process.env.LICENSE_ISSUER_ENABLED = "true";
  process.env.LICENSE_SIGNING_KEY_ID = "test-key";
  process.env.LICENSE_SIGNING_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.LICENSE_TRUSTED_PUBLIC_KEYS = JSON.stringify({ "test-key": pair.publicKey.export({ type: "spki", format: "pem" }).toString() });
  vi.resetModules();
  signedLicense = await import("../services/signed-license");
});

afterEach(async () => {
  process.env = originalEnv;
  vi.resetModules();
  await rm(stateDir, { recursive: true, force: true });
});

describe("signed license certificates", () => {
  it("signs and verifies a license for one installation", async () => {
    const request = await signedLicense.createActivationRequest("subcity.example.org");
    const certificate = signedLicense.createLicenseCertificate({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      host: request.host,
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: null,
    });

    expect(signedLicense.verifyLicenseCertificate(certificate)).toMatchObject({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      licensee: "Sub-city A",
      host: request.host,
    });
    expect(signedLicense.verifyLicenseCertificate({ ...certificate, signature: "invalid" })).toBeNull();
  });

  it("keeps old licenses valid while signing with a rotated key", async () => {
    const request = await signedLicense.createActivationRequest("subcity.example.org");
    const previousPair = crypto.generateKeyPairSync("ed25519");
    process.env.LICENSE_SIGNING_KEY_ID = "old-key";
    process.env.LICENSE_SIGNING_PRIVATE_KEY = previousPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.LICENSE_TRUSTED_PUBLIC_KEYS = JSON.stringify({ "old-key": previousPair.publicKey.export({ type: "spki", format: "pem" }).toString() });
    const previous = signedLicense.createLicenseCertificate({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      host: request.host,
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: null,
    });

    const currentPair = crypto.generateKeyPairSync("ed25519");
    process.env.LICENSE_SIGNING_KEY_ID = "current-key";
    process.env.LICENSE_SIGNING_PRIVATE_KEY = currentPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.LICENSE_TRUSTED_PUBLIC_KEYS = JSON.stringify({
      "old-key": previousPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      "current-key": currentPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const current = signedLicense.createLicenseCertificate({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      host: request.host,
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: null,
    });

    expect(signedLicense.verifyLicenseCertificate(previous)).not.toBeNull();
    expect(signedLicense.verifyLicenseCertificate(current)?.keyId).toBe("current-key");
  });

  it("keeps installation identity stable in persistent state across module restarts", async () => {
    const first = await signedLicense.createActivationRequest("subcity.example.org");
    vi.resetModules();
    signedLicense = await import("../services/signed-license");
    const second = await signedLicense.createActivationRequest("subcity.example.org");

    expect(second.installationId).toBe(first.installationId);
    expect(second.deploymentId).toBe(first.deploymentId);
  });

  it("refuses to sign licenses when issuer mode is disabled", () => {
    process.env.LICENSE_ISSUER_ENABLED = "false";
    expect(signedLicense.isLicenseIssuerEnabled()).toBe(false);
    expect(() => signedLicense.createLicenseCertificate({
      installationId: "installation",
      deploymentId: "deployment",
      host: "subcity.example.org",
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: null,
    })).toThrow("License issuing is not enabled");
  });
});
