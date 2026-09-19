// サブエージェントの数え上げと、本体停止後の通知（hooks.json から呼ばれる）。
//   node agent_track.js start   … PreToolUse(Agent|Task): 起動 +1
//   node agent_track.js stop    … SubagentStop: 終了 -1。本体が止まっていて最後の 1 つなら通知
//   node agent_track.js prompt  … UserPromptSubmit: 次の指示。本体停止の印を消す
//   node agent_track.js end     … SessionEnd: 状態ファイルを消す
// どの場合も exit 0（Claude Code の動作を止めない）。UserPromptSubmit では stdout に何も書かない（文脈に混ざるため）。
const { readStdinJson } = require("./common");
const state = require("./notify_state");

const mode = process.argv[2];
const data = readStdinJson();
const sid = data.session_id || "unknown";

try {
  if (mode === "start") state.agentStarted(sid);
  else if (mode === "stop") state.agentStopped(sid);
  else if (mode === "prompt") state.turnStarted(sid);
  else if (mode === "end") state.sessionEnded(sid);
} catch (e) {
  process.stderr.write(`dev-guard agent_track(${mode}) でエラー: ${e.message}\n`);
}
process.exit(0);
