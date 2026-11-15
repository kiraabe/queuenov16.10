import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/db", () => ({
  getLicenseIssuanceForCheckDb: vi.fn(),
}));

vi.mock("../services/signed-license", () => ({
  isLicenseIssuerEnabled: vi.fn(() => true),
  verifyLicenseCertificate: vi.fn(() => ({
    version: 1,
    licenseId: "license-id",
    installationId: "installation-id",
    deploymentId: "deployment-id",
    host: "subcity.example.org",
    licensee: "Sub-city A",
    supersedesLicenseId: null,
    product: "STC",
    issuedAt: Date.now(),
    expiresAt: null,
    keyId: "test-key",
  })),
}));

import { getLicenseIssuanceForCheckDb } from "../store/db";
import { onlineLicenseCheckHandler } from "../routes/license";

const certificate = { payload: "signed-payload", signature: "signed-value" };
const issuance = {
  licenseId: "license-id",
  installationId: "installation-id",
  deploymentId: "deployment-id",
  licensee: "Sub-city A",
  status: "active",
  certificate,
  expiresAt: null,
};

function responseMock() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { status, json } as never, status, json };
}

describe("online license status endpoint", () => {
  beforeEach(() => {
    vi.mocked(getLicenseIssuanceForCheckDb).mockResolvedValue(issuance as never);
  });

  it("returns the authoritative active issuance status", async () => {
    const { response, json } = responseMock();

    await onlineLicenseCheckHandler({ body: { certificate } } as never, response, vi.fn());

    expect(getLicenseIssuanceForCheckDb).toHaveBeenCalledWith("license-id");
    expect(json).toHaveBeenCalledWith({
      status: "active",
      licenseId: "license-id",
      licensee: "Sub-city A",
      expiresAt: null,
    });
  });

  it("returns not found when the issuance binding does not match", async () => {
    vi.mocked(getLicenseIssuanceForCheckDb).mockResolvedValue({ ...issuance, installationId: "another-installation" } as never);
    const { response, json } = responseMock();

    await onlineLicenseCheckHandler({ body: { certificate } } as never, response, vi.fn());

    expect(json).toHaveBeenCalledWith({ status: "not_found" });
  });

  it("reports an issued license as revoked", async () => {
    vi.mocked(getLicenseIssuanceForCheckDb).mockResolvedValue({ ...issuance, status: "revoked" } as never);
    const { response, json } = responseMock();

    await onlineLicenseCheckHandler({ body: { certificate } } as never, response, vi.fn());

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: "revoked" }));
  });
});
