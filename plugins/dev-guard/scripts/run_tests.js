// Stop: 終了直前にテストを実行。失敗なら exit 2 で差し戻す。
// tests/ があれば pytest、package.json に test があれば npm test。どちらも無ければ何もしない。
const fs = require("fs");
const { readStdinJson, findPython, run } = require("./common");
const data = readStdinJson();
if (data.stop_hook_active) process.exit(0);

function fail(r) {
  const out = ((r.stdout || "") + (r.stderr || "")).slice(-3000);
  process.stderr.write("テストが失敗しています。終了する前に直してください。\n" + out + "\n");
  process.exit(2);
}
if (fs.existsSync("tests")) {
  const py = findPython();
  if (!py) process.exit(0);
  const r = run(py, ["-m", "pytest", "tests", "-q", "-x", "--no-header"]);
  if (r.status !== 0) fail(r);
} else if (fs.existsSync("package.json")) {
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {}; } catch {}
  if (scripts.test) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = run(npm, ["test", "--silent"], { shell: process.platform === "win32" });
    if (r.status !== 0) fail(r);
  }
}
