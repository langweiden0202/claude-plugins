// 通知の保険。本体停止の印が付いてから N 秒経っても通知していなければ 1 回だけ鳴らす
// （SubagentStop の数え漏れなどで通知が保留のまま残るのを防ぐ）。
// 使い方: node notify_watcher.js <session_id> <stoppedAt(ms)> <seconds>
// Stop フックから独立したプロセスとして起動される（notify_state.mainStopped）。
const { fallbackNotify } = require("./notify_state");

const [sid, stoppedAtText, secondsText] = process.argv.slice(2);
const stoppedAt = Number(stoppedAtText);
const seconds = Math.max(1, Number(secondsText) || 600);

setTimeout(() => {
  try { fallbackNotify(sid, stoppedAt); } catch { }
  process.exit(0);
}, seconds * 1000);
