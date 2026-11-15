import { afterEach, describe, expect, it } from "vitest";
import { getLicenseHost } from "../utils/license-host";

describe("license host configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(["localhost", "stc.localhost", "127.0.0.1", "127.12.34.56", "[::1]"])(
    "rejects loopback host %s in production",
    (host) => {
      process.env.NODE_ENV = "production";
      process.env.LICENSE_HOST = host;

      expect(getLicenseHost({ hostname: host } as never)).toBeNull();
    },
  );

  it("accepts a configured public hostname in production", () => {
    process.env.NODE_ENV = "production";
    process.env.LICENSE_HOST = "STC.Example.org";

    expect(getLicenseHost({ hostname: "localhost" } as never)).toBe("stc.example.org");
  });

  it("allows localhost in development when no hostname is configured", () => {
    process.env.NODE_ENV = "development";
    delete process.env.LICENSE_HOST;

    expect(getLicenseHost({ hostname: "localhost" } as never)).toBe("localhost");
  });
});
