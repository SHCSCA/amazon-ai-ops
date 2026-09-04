import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

const sourceFiles = [
  new URL("../src/App.jsx", import.meta.url),
  new URL("../src/prototype-workspaces.jsx", import.meta.url),
];

test("原型主界面 JSX 可被解析", async () => {
  for (const fileUrl of sourceFiles) {
    const source = await readFile(fileUrl, "utf8");
    const result = await transformWithEsbuild(source, fileURLToPath(fileUrl), {
      loader: "jsx",
      jsx: "automatic",
      sourcemap: false,
    });
    assert.ok(result.code.length > 0, fileURLToPath(fileUrl));
  }
});
