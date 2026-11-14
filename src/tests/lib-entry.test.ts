import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { FIXTURES, PACKAGE_NAME, PACKAGE_ROOT, createConsumer, type Consumer } from "./fixtures/lib/consumer-project.js";

let consumer: Consumer;

beforeEach(() => {
  consumer = createConsumer();
});

afterEach(() => {
  consumer.cleanup();
});

describe("library entry import", () => {
  it("runs no command, prints nothing, writes nothing and sets no exit code when argv holds a kf command", () => {
    const probe = `import "${PACKAGE_NAME}/lib";\nprocess.stdout.write(JSON.stringify({ exitCode: process.exitCode }) + "\\n");\n`;

    const res = consumer.run(probe, ["status"]);

    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toBe("");
    expect(res.stdout).toBe("{}\n");
    expect(readdirSync(consumer.dir).sort()).toEqual(["node_modules", "probe.mjs"]);
    expect(readdirSync(consumer.home)).toEqual([]);
  });

  it("refuses a deep import into dist because only the entry and the library are exported", () => {
    const res = consumer.run(`import "${PACKAGE_NAME}/dist/workflow/status.js";\n`);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
  });
});

describe("TypeScript consumer", () => {
  it("typechecks a file that imports every library function and type against the built declarations", () => {
    copyFileSync(join(FIXTURES, "consumer.ts.txt"), join(consumer.dir, "consumer.ts"));
    writeFileSync(
      join(consumer.dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        include: ["consumer.ts"],
      }),
    );
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

    const res = spawnSync(process.execPath, [tsc, "-p", consumer.dir], { cwd: consumer.dir, encoding: "utf8" });

    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
    expect(res.stdout).toBe("");
  });
});

describe("CLI entry", () => {
  it("keeps the entry and the kf binary on dist/index.js and prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      version: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
    };

    expect(pkg.exports["."]).toBe("./dist/index.js");
    expect(pkg.bin.kf).toBe("dist/index.js");

    const res = spawnSync(process.execPath, ["dist/index.js", "--version"], { cwd: PACKAGE_ROOT, encoding: "utf8" });

    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe(pkg.version);
  });
});
