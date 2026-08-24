// Stop: 終了直前にテストを実行。失敗なら exit 2 で差し戻す。
// .NET(*.sln / *.csproj) があれば dotnet test、tests/ があれば pytest、
// package.json に test があれば npm test。どれも無ければ何もしない。
const fs = require("fs");
const { readStdinJson, findPython, run } = require("./common");
const data = readStdinJson();
if (data.stop_hook_active) process.exit(0);

// pytest は「テストを1件も集められなかった」を終了コード5で返す。
// C# や Go のリポジトリにも tests/ はあるので、これを失敗にすると誤検知になる。
const PYTEST_NO_TESTS_COLLECTED = 5;

function fail(r) {
  const out = ((r.stdout || "") + (r.stderr || "")).slice(-3000);
  process.stderr.write("テストが失敗しています。終了する前に直してください。\n" + out + "\n");
  process.exit(2);
}

// リポジトリ直下のソリューション/プロジェクトを探す。
// dotnet test は引数なしでも動くが、対象を明示したほうが誤爆しない。
function findDotnetProject() {
  let entries;
  try {
    entries = fs.readdirSync(".", { withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  return (
    files.find((n) => /\.slnx?$/i.test(n)) ||
    files.find((n) => /\.(csproj|fsproj|vbproj)$/i.test(n)) ||
    null
  );
}

// .NET は tests/ より先に見る。C# のリポジトリにも tests/ はあるので、
// 先に pytest を走らせると「Pythonのテストが0件」で毎回止まってしまう。
const dotnetProject = findDotnetProject();
if (dotnetProject) {
  // dotnet が入っていない環境では何もしない（Python が無いときと同じ扱い）。
  const probe = run("dotnet", ["--version"], { shell: process.platform === "win32" });
  if (probe.status !== 0) process.exit(0);
  const r = run("dotnet", ["test", dotnetProject, "--nologo"], {
    shell: process.platform === "win32",
  });
  if (r.status !== 0) fail(r);
} else if (fs.existsSync("tests")) {
  const py = findPython();
  if (!py) process.exit(0);
  const r = run(py, ["-m", "pytest", "tests", "-q", "-x", "--no-header"]);
  if (r.status !== 0 && r.status !== PYTEST_NO_TESTS_COLLECTED) fail(r);
} else if (fs.existsSync("package.json")) {
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {}; } catch {}
  if (scripts.test) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const r = run(npm, ["test", "--silent"], { shell: process.platform === "win32" });
    if (r.status !== 0) fail(r);
  }
}
