import { describe, expect, it } from "vitest";
import { findInstallationHostConflict } from "../store/db";

const certificateFor = (host: string) => ({
  payload: Buffer.from(JSON.stringify({ host })).toString("base64url"),
  signature: "unused",
});

describe("installation host binding", () => {
  it("reports the bound host when an installation is reused under another host", () => {
    expect(findInstallationHostConflict([certificateFor("localhost")], "cttcs-solution.onrender.com")).toBe("localhost");
  });

  it("allows renewal for the same host", () => {
    expect(findInstallationHostConflict([certificateFor("localhost")], "localhost")).toBeNull();
  });

  it("allows an installation with no prior issuances", () => {
    expect(findInstallationHostConflict([], "cttcs-solution.onrender.com")).toBeNull();
  });
});
