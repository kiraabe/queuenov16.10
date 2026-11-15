import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceLicense } from "../middleware/license-enforcement";
import { validateLicense } from "../services/license-service";

vi.mock("../services/license-service", () => ({
  validateLicense: vi.fn(),
  recordLicenseValidationEvent: vi.fn(),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.LICENSE_HOST = "subcity.example.org";
  vi.mocked(validateLicense).mockResolvedValue({
    valid: false,
    mode: "restricted",
    message: "License expired",
    errorCode: "LICENSE_EXPIRED",
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function run(method: string, path: string) {
  const next = vi.fn();
  const json = vi.fn();
  const response = { status: vi.fn(() => ({ json })) };
  enforceLicense({ method, path } as never, response as never, next);
  return { next, response, json };
}

describe("restricted license enforcement", () => {
  it("keeps case viewing and queue processing available", async () => {
    for (const [method, path] of [
      ["GET", "/tickets/STC-1001"],
      ["POST", "/tickets"],
      ["POST", "/windows/1/call-next"],
      ["POST", "/windows/1/complete"],
    ]) {
      const result = run(method, path);
      await vi.waitFor(() => expect(result.next).toHaveBeenCalledOnce());
      expect(result.response.status).not.toHaveBeenCalled();
    }
  });

  it("blocks admin mutations after grace", async () => {
    const result = run("POST", "/admin/users");
    await vi.waitFor(() => expect(result.response.status).toHaveBeenCalledWith(403));
    expect(result.next).not.toHaveBeenCalled();
  });

  it("keeps admin record reads available after grace", async () => {
    const result = run("GET", "/admin/users");
    await vi.waitFor(() => expect(result.next).toHaveBeenCalledOnce());
    expect(result.response.status).not.toHaveBeenCalled();
  });
});
