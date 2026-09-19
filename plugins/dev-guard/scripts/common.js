// Node.js は Claude Code 自体が必要とするので必ず存在する。
// Python は 作業ツリーの .venv → python3 → python の順で探す。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readStdinJson() {
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { return {}; }
}

// 作業ツリー直下の .venv にある Python。無ければ null。
// リポジトリ専用の仮想環境に pytest 等が入っているので、PATH の python より先に使う。
function venvPython(cwd = process.cwd()) {
  const candidates = process.platform === "win32"
    ? [path.join(cwd, ".venv", "Scripts", "python.exe")]
    : [path.join(cwd, ".venv", "bin", "python3"), path.join(cwd, ".venv", "bin", "python")];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 使う Python のコマンド（フルパスまたはコマンド名）。見つからなければ null。
function findPython(cwd = process.cwd()) {
  const venv = venvPython(cwd);
  const candidates = venv ? [venv, "python3", "python"] : ["python3", "python"];
  for (const c of candidates) {
    const r = spawnSync(c, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && (r.stdout || "").trim() === "3") return c;
  }
  return null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
}

// PowerShell の単引用符リテラルにする（' は '' に）
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// 短い PowerShell を同期で呼ぶ（0.3〜0.7 秒）。失敗しても hook 本体は止めない。
function runPowerShell(command, timeout = 15000) {
  return spawnSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout });
}

// このプロセスから親をたどった PID の列（近い順）。"pid1,pid2,..." の文字列。Windows 以外は ""。
// hook を動かしたシェルはすぐ終わるので、全員が生きている hook 実行中に調べておく。
function getAncestorChain() {
  if (process.platform !== "win32") return "";
  const cmd = [
    "$map=@{}; foreach($p in (Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)){ $map[[int]$p.ProcessId]=[int]$p.ParentProcessId }",
    "$chain=@(); $c=" + process.pid + "; $seen=@{}",
    "for($i=0; $i -lt 20 -and $c -gt 0 -and -not $seen.ContainsKey($c); $i++){ $seen[$c]=$true; $chain+=$c; if(-not $map.ContainsKey($c)){ break }; $c=$map[$c] }",
    "Write-Output ($chain -join ',')",
  ].join("; ");
  try {
    // WMI が遅い環境で Stop フックを長く塞がないよう 5 秒で諦める（その場合 notify.ps1 が -ParentPid からたどる）
    const r = runPowerShell(cmd, 5000);
    return r.status === 0 ? (r.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

// hook が終わっても生き残る独立したプロセスを起動する（Windows のみ）。
//
// なぜ Start-Process を経由するか:
//   Node の spawn({detached:true}) は DETACHED_PROCESS（コンソール無し）で起動するため
//   powershell.exe 5.1 が何もせず即終了する。かといって detached 無しでは hook 本体の
//   終了と一緒に子も終了させられる。短い PowerShell を同期で呼び、その中の Start-Process で
//   独立したプロセス（隠しコンソール）として起動すると、hook が終わっても生き残る。
function launchDetached(exe, args) {
  if (process.platform !== "win32") return false;
  // Start-Process の -ArgumentList は要素をスペースで連結するだけで個別にクォートしない。
  // パスやフォルダ名にスペースが入っても壊れないよう、各要素を "..." で包んで渡す（" は \" に）。
  const list = args.map((a) => psQuote('"' + String(a).replace(/(\\*)"/g, '$1$1\\"') + '"')).join(",");
  const cmd = `Start-Process -FilePath ${psQuote(exe)} -WindowStyle Hidden -ArgumentList @(${list})`;
  try {
    const r = runPowerShell(cmd);
    if (r.status !== 0) {
      process.stderr.write("バックグラウンド起動に失敗しました: " + (r.stderr || "").slice(-500) + "\n");
      return false;
    }
    return true;
  } catch (e) {
    process.stderr.write("バックグラウンド起動に失敗しました: " + e.message + "\n");
    return false;
  }
}

// 作業終了の通知（音＋ポップアップ）を別プロセスで出す。この関数は 0.5 秒ほどで戻る。
// chain: 表示位置を決めるための親プロセスの系列（getAncestorChain の結果）。
// 環境変数 DEV_GUARD_NOTIFY_TEST=1 なら試験モード（音なし・3秒で閉じる）。
function notifyDone(cwd = process.cwd(), chain = "") {
  if (process.platform !== "win32") return;
  const script = path.join(__dirname, "notify.ps1");
  const project = path.basename(cwd) || cwd;
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
    "-File", script, "-Project", project, "-ParentPid", String(process.ppid), "-Chain", chain || ""];
  if (process.env.DEV_GUARD_NOTIFY_TEST === "1") args.push("-TestMode");
  launchDetached("powershell.exe", args);
}

module.exports = { readStdinJson, findPython, venvPython, run, getAncestorChain, launchDetached, notifyDone };
