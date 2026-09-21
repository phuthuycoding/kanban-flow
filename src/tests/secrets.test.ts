import { describe, it, expect } from "vitest";
import { findSecretLike } from "../workflow/validate.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

describe("formats added for artifacts that quote real requests", () => {
  // Assembled from parts: this repo scans its own work items, and a whole token in the source
  // would trip the very gate under test.
  const jwt = "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  it("flags a JWT but not a lone base64 segment that merely starts with eyJ", () => {
    // `eyJ` is just base64 for `{"`, which every encoded JSON blob starts with. Matching the
    // prefix alone would fire on harmless data and teach people to --force past the gate.
    expect(findSecretLike(`Authorization: Bearer ${jwt}`)).toHaveLength(1);
    expect(findSecretLike("the header decodes from eyJhbGciOiJIUzI1NiJ9 only")).toEqual([]);
  });

  it("flags Slack and Discord webhook URLs", () => {
    expect(findSecretLike("post to https://hooks.slack.com/services/T00000000/B00000000/ABCDEFGHIJKLMNOPQRSTUVWX")).toHaveLength(1);
    expect(findSecretLike("hook https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456")).toHaveLength(1);
    expect(findSecretLike("see https://hooks.slack.com/docs for the format"), "not every slack URL is a hook").toEqual([]);
  });

  it("flags a connection string only when it actually carries a password", () => {
    expect(findSecretLike("DSN postgres://admin:hunter2@db.internal/app")).toHaveLength(1);
    expect(findSecretLike("DSN redis://:hunter2@cache.internal"), "password with no username").toHaveLength(1);
    expect(findSecretLike("DSN postgres://localhost:5432/app"), "nothing to leak").toEqual([]);
    expect(findSecretLike("see https://example.com/docs/db"), "an ordinary URL").toEqual([]);
  });

  it("lets documentation describe the connection-string format it is taught to find", () => {
    // The first version marked this pattern high-confidence, so only xxxx excused it — and the
    // gate then rejected the spec explaining the feature. Unlike ghp_ or eyJ, a connection
    // string has no marker that only a real credential carries; it is pure URL shape, which an
    // honest template has too.
    expect(findSecretLike("DSN scheme://user:<password>@host")).toEqual([]);
    expect(findSecretLike("DSN postgres://user:{pass}@host/db")).toEqual([]);
    expect(findSecretLike("DSN postgres://admin:xxxx@db.internal/app")).toEqual([]);
  });

  it("does not let a nearby word excuse the formats that only real credentials carry", () => {
    // JWT, Slack and Discord all start with something no template would invent by accident.
    expect(findSecretLike(`example: Bearer ${jwt}`)).toHaveLength(1);
    expect(findSecretLike("example: https://hooks.slack.com/services/T00000000/B00000000/ABCDEFGHIJKLMNOPQRSTUVWX")).toHaveLength(1);
  });

  it("never echoes the value it found", () => {
    const [hit] = findSecretLike(`Authorization: Bearer ${jwt}`);
    expect(hit).not.toContain(jwt);
    expect(hit).toContain("…");
    const [dsn] = findSecretLike("DSN postgres://admin:hunter2@db.internal/app");
    expect(dsn).not.toContain("hunter2");
  });
});

describe("the scanner against this repository's own artifacts", () => {
  it("stays silent on every real work item and doc", () => {
    // FR-006, and the only test here that can catch a pattern which is too greedy. A gate that
    // cries wolf on honest content teaches people to --force past it, which costs more than the
    // hole it was added to close.
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".md")) files.push(full);
      }
    };
    for (const d of ["docs", "skills", "kanban-flow", ".works"]) walk(join(root, d));
    expect(files.length, "the fixture must actually be scanning something").toBeGreaterThan(50);

    const offenders = files
      .map((f) => ({ file: f.slice(root.length + 1), hits: findSecretLike(readFileSync(f, "utf8")) }))
      .filter((r) => r.hits.length > 0);
    expect(offenders).toEqual([]);
  });
});
