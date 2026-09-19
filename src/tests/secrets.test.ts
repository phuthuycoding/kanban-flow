import { describe, it, expect } from "vitest";
import { findSecretLike } from "../workflow/validate.js";

const ghp = "ghp_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("findSecretLike flags real secrets even when the line mentions a placeholder word", () => {
  it.each([
    [`TOKEN=${ghp}  # example for prod`],
    [`Authorization: Bearer ${jwt} (sample request)`],
    ["aws key AKIAIOSFODNN7EXAMPLE from the example account"],
    ["PASSWORD=Sup3rS3cretValue # changeme later"],
  ])("flags %s", (line) => {
    const hits = findSecretLike(`# Spec\n${line}\nFR-001 ok`);
    expect(hits).toHaveLength(1);
  });

  it("masks the credential value in the returned hit", () => {
    const [hit] = findSecretLike(`TOKEN=${ghp}  # example for prod`);
    expect(hit).not.toContain(ghp);
    expect(hit).toContain("ghp_…");
  });
});

describe("findSecretLike keeps accepting placeholder values", () => {
  it.each([
    ["API_KEY={key}"],
    ["Authorization: Bearer <token>"],
    ["TOKEN=changeme"],
    ["TOKEN=ghp_" + "x".repeat(36)],
    ["SECRET=************"],
    ["PASSWORD=your_password_here"],
    ["AKIA" + "X".repeat(16)],
  ])("does not flag %s", (line) => {
    expect(findSecretLike(`# Spec\n${line}\n`)).toEqual([]);
  });

  it("still flags a real private key header", () => {
    expect(findSecretLike("-----BEGIN RSA PRIVATE KEY-----\nMIIE")).toHaveLength(1);
  });
});
