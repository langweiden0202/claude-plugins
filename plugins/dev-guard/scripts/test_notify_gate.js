// 通知の関門（notify_gate.js）の単体テスト（1.3.0）。
//   使い方: node scripts/test_notify_gate.js
// ① decide() が、途中経過の返答では鳴らさず、完了の目印がある返答でだけ鳴らすと判断すること
// ② Stop フック本体（run_tests.js）を試験モード（DEV_GUARD_NOTIFY_TEST=1・ポップアップも音も出ない）で
//    実際に動かし、notify.log に「途中経過は skip」「【完了】は would-notify（鳴らすはずだった）1 回」と残ること
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { decide, DONE_MARKS } = require("./notify_gate");

let ok = 0, ng = 0;
const check = (label, cond, note = "") => { (cond ? ok++ : ng++); console.log(`${cond ? "OK" : "NG"}  ${label}${note ? "  … " + note : ""}`); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), "dg-gate-"));
const line = (role, text) => JSON.stringify({ type: role, message: { role, content: [{ type: "text", text }] } });
const tool = () => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } });
function transcript(name, lines) { const p = path.join(work, name + ".jsonl"); fs.writeFileSync(p, lines.join("\n") + "\n", "utf8"); return p; }

// ---- ① decide()
const mid = transcript("mid", [line("user", "直して"), line("assistant", "テストを直しました。次に実機確認へ進みます。"), tool()]);
const done = transcript("done", [line("user", "直して"), line("assistant", "途中経過です"), line("assistant", "【完了】v1.0.0 を直しました。")]);
const dev = transcript("dev", [line("assistant", "v2.15.0（開発版）動作確認できます。テスト2049件成功。")]);
const inst = transcript("inst", [line("assistant", "v2.15.0 完成です。テスト成功、リリースまで一気通貫で完了しています。")]);
const ask = transcript("ask", [line("assistant", "【判断待ち】保存先を A と B のどちらにしますか。")]);
const midAfterDone = transcript("mid2", [line("assistant", "【完了】前の指示は終わりました"), line("user", "次の指示"), line("assistant", "裏で待っています。届き次第つづけます。")]);
check("途中経過の返答（目印なし）では鳴らさない", decide(mid).notify === false, decide(mid).why);
check("最後の返答がツール呼び出しだけでも、直前の本文で判定する（途中経過なら鳴らさない）", decide(mid).notify === false);
check("「【完了】」があれば鳴らす", decide(done).notify === true && decide(done).mark === "【完了】");
check("「動作確認できます」（開発版の完了報告）で鳴らす", decide(dev).notify === true && decide(dev).mark === "動作確認できます");
check("「完成です」（インストーラー完了報告）で鳴らす", decide(inst).notify === true && decide(inst).mark === "完成です");
check("「【判断待ち】」で鳴らす", decide(ask).notify === true && decide(ask).mark === "【判断待ち】");
check("前の指示の【完了】は数えない（最後の返答だけを見る）", decide(midAfterDone).notify === false);
check("transcript が無ければ鳴らさない", decide("").notify === false && decide(path.join(work, "none.jsonl")).notify === false);
check("目印は 4 つ", DONE_MARKS.length === 4 && DONE_MARKS.includes("【完了】") && DONE_MARKS.includes("【判断待ち】"));

// ---- ② Stop フック本体を試験モードで動かす（テストの無い空フォルダを cwd にする＝テストは走らない）
const cwd = path.join(work, "proj-x"); fs.mkdirSync(cwd);
const logPath = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dev-guard", "notify.log");
const before = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").length : 0;
const runHook = (transcriptPath, sid) => spawnSync(process.execPath, [path.join(__dirname, "run_tests.js")], {
  input: JSON.stringify({ session_id: sid, cwd, transcript_path: transcriptPath, hook_event_name: "Stop" }),
  env: { ...process.env, DEV_GUARD_NOTIFY_TEST: "1" }, encoding: "utf8", windowsHide: true, timeout: 60000,
});
const r1 = runHook(mid, "gate-test-1");
const r2 = runHook(done, "gate-test-2");
const r3 = runHook(done, "gate-test-2");   // 同じ停止の二重呼び出し（数秒内）は 1 回にまとめる
const after = fs.readFileSync(logPath, "utf8").slice(before);
const lines = after.split(/\r?\n/).filter((l) => l.includes("[proj-x]"));
check("Stop フックは途中経過でも異常終了しない", r1.status === 0 && r2.status === 0 && r3.status === 0, `${r1.status},${r2.status},${r3.status} ${(r1.stderr || "").slice(0, 80)}`);
check("途中経過では skip がログに残り、would-notify は無い", lines.some((l) => /skip: 途中経過/.test(l)) && !lines.slice(0, lines.findIndex((l) => /gate:/.test(l)) < 0 ? lines.length : lines.findIndex((l) => /gate:/.test(l))).some((l) => /would-notify/.test(l)), lines.slice(0, 2).join(" | "));
const would = lines.filter((l) => /would-notify/.test(l)).length;
check("【完了】では would-notify（鳴らすはずだった）が 1 回だけ", would === 1, `${would}回: ${lines.filter((l) => /would-notify|gate:|二重/.test(l)).join(" | ").slice(0, 300)}`);

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${ok} OK / ${ng} NG`);
process.exitCode = ng ? 1 : 0;
