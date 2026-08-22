// PostToolUse: .py を書き換えた直後に構文チェック。壊れていれば exit 2 で差し戻す。
const { readStdinJson, findPython, run } = require("./common");
const data = readStdinJson();
const p = (data.tool_input && data.tool_input.file_path) || "";
if (!p.endsWith(".py")) process.exit(0);
const py = findPython();
if (!py) process.exit(0);
const r = run(py, ["-m", "py_compile", p]);
if (r.status !== 0) {
  process.stderr.write(`構文エラー: ${p}\n${(r.stderr || r.stdout || "").slice(-2000)}\n修正してから先に進んでください。\n`);
  process.exit(2);
}
