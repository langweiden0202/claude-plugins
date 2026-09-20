// 「本当に全部終わった時」に1回だけ通知するための、セッションごとの状態。
//
//   agents      : 起動中のサブエージェント数（PreToolUse(Agent) で +1、SubagentStop で -1）
//   mainStopped : 本体（Claude 本体の返答）が止まった印。UserPromptSubmit（次の指示）で消える
//   stoppedAt   : 印を付けた時刻（ms）。数秒内の二重 Stop を 1 回にまとめる判定に使う
//   notified    : この印に対して通知済みか
//   chain, cwd  : 通知の表示位置とプロジェクト名（Stop 時に保存）
//
// 1.2.0（恒久ルール 10）: 通知を出すのは「本体の Stop で、裏のエージェントが 0 のとき」だけ。
//   SubagentStop では鳴らさない（サブエージェントが終わっても本体はその結果を受けて続きをやる）。
//   本体が止まった時点で裏のエージェントが残っていれば鳴らさず、本体はエージェントの結果を受けて再開し、
//   最後の Stop（残り 0）で 1 回だけ鳴る。10 分の保険通知（notify_watcher.js）は廃止。
//
// 状態は %LOCALAPPDATA%\dev-guard\sessions\<session_id>.json。
// 複数の hook が同時に走る（並列 Agent 起動など）ので、mkdir によるロックで読み書きを直列化する。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getAncestorChain, notifyDone, logNotify } = require("./common");

const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dev-guard", "sessions");
const LOCK_STALE_MS = 10000;

function stateFile(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(STATE_DIR, safe + ".json");
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lock(file) {
  const dir = file + ".lock";
  for (let i = 0; i < 250; i++) {
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(dir); continue; }
      } catch { /* 競合で消えた */ }
      sleepMs(20);
    }
  }
  throw new Error("ロックを取得できません: " + dir);
}

function unlock(dir) {
  try { fs.rmdirSync(dir); } catch { }
}

function emptyState() {
  return { agents: 0, mainStopped: false, stoppedAt: 0, notified: false, chain: "", cwd: "" };
}

// ロックの中で state を読み、fn で書き換え、保存する。fn の戻り値を返す。
function withState(sessionId, fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(sessionId);
  const l = lock(file);
  try {
    let state = emptyState();
    try { state = { ...state, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { }
    const result = fn(state);
    if (state.__delete) {
      try { fs.unlinkSync(file); } catch { }
    } else {
      fs.writeFileSync(file, JSON.stringify(state), "utf8");
    }
    return result;
  } finally {
    unlock(l);
  }
}

// 通知を出してよいか（本体停止の印があり、残りエージェント 0、まだ通知していない）
function shouldNotify(state) {
  return state.mainStopped && state.agents <= 0 && !state.notified;
}

// サブエージェント起動（PreToolUse: Agent / Task）
function agentStarted(sessionId) {
  withState(sessionId, (s) => { s.agents += 1; });
}

// サブエージェント終了（SubagentStop）。数を減らすだけで、ここでは鳴らさない（恒久ルール 10）。
// 本体はサブエージェントの結果を受けて続きをやるので、通知は本体の最後の Stop で出す。
function agentStopped(sessionId) {
  const r = withState(sessionId, (s) => {
    s.agents = Math.max(0, s.agents - 1);
    return { cwd: s.cwd, agents: s.agents };
  });
  logNotify(r.cwd || process.cwd(), `skip: SubagentStop（鳴らさない。残り ${r.agents}。通知は本体の最後の Stop で）`);
}

// 本体停止（Stop フックの最後）。裏のエージェントが 0 なら 1 回だけ通知。残っていれば鳴らさない
// （本体はエージェントの結果を受けて再開し、その最後の Stop で鳴る。保険の通知は無い）。
function mainStopped(sessionId, cwd) {
  const chain = getAncestorChain();
  const now = Date.now();
  const r = withState(sessionId, (s) => {
    // Stop フックが二重登録されている等で数秒内に 2 回呼ばれても、通知は 1 回にする
    if (s.mainStopped && now - s.stoppedAt < 3000) return { r: "duplicate" };
    s.mainStopped = true;
    s.stoppedAt = now;
    s.notified = false;
    s.chain = chain;
    s.cwd = cwd;
    if (shouldNotify(s)) { s.notified = true; return { r: "now" }; }
    return { r: "pending", agents: s.agents };
  });
  if (r.r === "now") {
    logNotify(cwd, "notify: Stop で本体停止、裏のエージェント 0 → 通知");
    notifyDone(cwd, chain);
  } else if (r.r === "pending") {
    logNotify(cwd, `hold: Stop で本体停止したが裏のエージェントが残り ${r.agents} → 鳴らさない（本体が再開して最後に止まったとき 1 回）`);
  } else {
    logNotify(cwd, "skip: 数秒内の二重 Stop → 1 回にまとめる");
  }
  return r.r;
}

// 次の指示が来た（UserPromptSubmit）。本体は動き出すので印を消す。
function turnStarted(sessionId) {
  withState(sessionId, (s) => { s.mainStopped = false; s.notified = false; s.stoppedAt = 0; });
}

// セッション終了（SessionEnd）。状態ファイルを消す。
function sessionEnded(sessionId) {
  withState(sessionId, (s) => { s.__delete = true; });
}

// 2 日より古い状態ファイルを消す（SessionStart から）。
function pruneOld() {
  try {
    const limit = Date.now() - 2 * 24 * 3600 * 1000;
    for (const name of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, name);
      try { if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { recursive: true, force: true }); } catch { }
    }
  } catch { }
}

module.exports = {
  STATE_DIR, stateFile, withState, agentStarted, agentStopped, mainStopped,
  turnStarted, sessionEnded, pruneOld,
};
