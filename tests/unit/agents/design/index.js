import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

for (const file of fs.readdirSync(__dirname).sort()) {
  if (file === "index.js") continue;
  if (!file.endsWith(".test.js")) continue;
  await import(path.join(__dirname, file));
}
