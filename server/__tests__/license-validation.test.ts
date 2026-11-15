import crypto from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/db", () => ({
  getLicenseByKeyDb: vi.fn(),
  getPrimaryLicenseDb: vi.fn(),
  updateLicenseHostDb: vi.fn(),
}));

let stateDir: string;
let originalEnv: NodeJS.ProcessEnv;
let signedLicense: typeof import("../services/signed-license");
let service: typeof import("../services/license-service");

beforeEach(async () => {
  originalEnv = { ...process.env };
  stateDir = await mkdtemp(path.join(os.tmpdir(), "stc-validation-test-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  process.env.LICENSE_STATE_DIR = stateDir;
  process.env.LICENSE_ISSUER_ENABLED = "true";
  process.env.LICENSE_SIGNING_KEY_ID = "test-key";
  process.env.LICENSE_SIGNING_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.LICENSE_TRUSTED_PUBLIC_KEYS = JSON.stringify({ "test-key": pair.publicKey.export({ type: "spki", format: "pem" }).toString() });
  process.env.LICENSE_GRACE_PERIOD_DAYS = "30";
  vi.resetAllMocks();
  vi.resetModules();
  signedLicense = await import("../services/signed-license");
  service = await import("../services/license-service");
});

afterEach(async () => {
  process.env = originalEnv;
  vi.resetModules();
  await rm(stateDir, { recursive: true, force: true });
});

async function installLicense(expiresAt: number | null, host = "subcity.example.org") {
  const request = await signedLicense.createActivationRequest(host);
  const certificate = signedLicense.createLicenseCertificate({
    installationId: request.installationId,
    deploymentId: request.deploymentId,
    host,
    licensee: "Sub-city A",
    expiresAt,
    supersedesLicenseId: null,
  });
  await signedLicense.saveInstalledCertificate(certificate);
}

describe("local license validation", () => {
  it("verifies an installed license without querying the issuer database", async () => {
    await installLicense(null);
    const result = await service.validateLicense("subcity.example.org");
    expect(result).toMatchObject({ valid: true, mode: "active", licensee: "Sub-city A" });
  });

  it("keeps existing database-backed activation valid and recovers from a database outage", async () => {
    const database = await import("../store/db");
    process.env.LICENSE_KEY = "legacy-key";
    process.env.APP_SECRET = "test-app-secret";
    vi.mocked(database.getLicenseByKeyDb).mockResolvedValue({
      id: "legacy-license-id",
      licenseKey: "legacy-key",
      licensee: "Sub-city A",
      status: "active",
      expiresAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdByUserId: null,
      notes: null,
      activatedMachineId: null,
      activatedHost: null,
    });
    vi.mocked(database.updateLicenseHostDb).mockResolvedValue(true);

    const first = await service.validateLicense("subcity.example.org", "legacy-key");
    expect(first).toMatchObject({ valid: true, mode: "active", licensee: "Sub-city A" });
    expect(database.updateLicenseHostDb).toHaveBeenCalledWith("legacy-license-id", "subcity.example.org");

    vi.mocked(database.getLicenseByKeyDb).mockRejectedValue(new Error("database unavailable"));
    const recovered = await service.validateLicense("subcity.example.org");
    expect(recovered).toMatchObject({ valid: true, mode: "active", licensee: "Sub-city A" });
  });

  it("requires an activation request before legacy host migration grace", async () => {
    const database = await import("../store/db");
    process.env.LICENSE_KEY = "legacy-key";
    process.env.APP_SECRET = "test-app-secret";
    vi.mocked(database.getLicenseByKeyDb).mockResolvedValue({
      id: "legacy-license-id",
      licenseKey: "legacy-key",
      licensee: "Sub-city A",
      status: "active",
      expiresAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdByUserId: null,
      notes: null,
      activatedMachineId: null,
      activatedHost: null,
    });
    vi.mocked(database.updateLicenseHostDb).mockResolvedValue(true);

    await service.validateLicense("old.example.org", "legacy-key");
    const blocked = await service.validateLicense("new.example.org");
    expect(blocked).toMatchObject({ valid: false, mode: "restricted", errorCode: "LICENSE_HOST_MISMATCH" });

    await signedLicense.createActivationRequest("new.example.org");
    const grace = await service.validateLicense("new.example.org");
    expect(grace).toMatchObject({ valid: true, mode: "grace" });
  });

  it("does not fall back to legacy activation after signed activation", async () => {
    await installLicense(null);
    process.env.LICENSE_KEY = "legacy-key";
    await unlink(path.join(stateDir, "license.json"));

    const result = await service.validateLicense("subcity.example.org");
    expect(result).toMatchObject({ valid: false, mode: "restricted", errorCode: "LICENSE_STORAGE_ERROR" });
  });

  it("allows recoverable expiry during the configured grace period", async () => {
    await installLicense(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const result = await service.validateLicense("subcity.example.org");
    expect(result).toMatchObject({ valid: true, mode: "grace" });
    expect(result.warning).toContain("30 days");
  });

  it("restricts administration after grace while reporting essential work remains available", async () => {
    await installLicense(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const result = await service.validateLicense("subcity.example.org");
    expect(result).toMatchObject({ valid: false, mode: "restricted", errorCode: "LICENSE_EXPIRED" });
    expect(result.warning).toContain("case and queue operations remain available");
  });

  it("rejects an older license after a replacement is installed", async () => {
    const request = await signedLicense.createActivationRequest("subcity.example.org");
    const previous = signedLicense.createLicenseCertificate({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      host: request.host,
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: null,
    });
    const previousPayload = signedLicense.verifyLicenseCertificate(previous)!;
    await signedLicense.saveInstalledCertificate(previous);
    const replacement = signedLicense.createLicenseCertificate({
      installationId: request.installationId,
      deploymentId: request.deploymentId,
      host: request.host,
      licensee: "Sub-city A",
      expiresAt: null,
      supersedesLicenseId: previousPayload.licenseId,
    });
    await signedLicense.saveInstalledCertificate(replacement);

    await expect(signedLicense.saveInstalledCertificate(previous)).rejects.toThrow("newer installed license");
  });

  it("starts migration grace only after an activation request is generated", async () => {
    await installLicense(null, "old.example.org");
    const resultBeforeRequest = await service.validateLicense("new.example.org");
    expect(resultBeforeRequest).toMatchObject({ valid: false, errorCode: "LICENSE_HOST_MISMATCH" });

    await signedLicense.createActivationRequest("new.example.org");
    const resultAfterRequest = await service.validateLicense("new.example.org");
    expect(resultAfterRequest).toMatchObject({ valid: true, mode: "grace" });
  });
});
