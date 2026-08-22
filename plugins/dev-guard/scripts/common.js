// Node.js は Claude Code 自体が必要とするので必ず存在する。Python は python3 → python の順で探す。
const { spawnSync } = require("child_process");
const fs = require("fs");

function readStdinJson() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}
function findPython() {
  for (const c of ["python3", "python"]) {
    const r = spawnSync(c, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && (r.stdout || "").trim() === "3") return c;
  }
  return null;
}
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
}
module.exports = { readStdinJson, findPython, run };
