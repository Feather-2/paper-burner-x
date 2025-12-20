const fs = require("node:fs");
const path = require("node:path");

for (const file of fs.readdirSync(__dirname).sort()) {
  if (file === "index.js") continue;
  if (!file.endsWith(".test.js")) continue;
  require(path.join(__dirname, file));
}

