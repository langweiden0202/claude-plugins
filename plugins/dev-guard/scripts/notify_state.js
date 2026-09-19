// 「本当に全部終わった時」に1回だけ通知するための、セッションごとの状態。
//
//   agents      : 起動中のサブエージェント数（PreToolUse(Agent) で +1、SubagentStop で -1）
//   mainStopped : 本体（Claude 本体の返答）が止まった印。UserPromptSubmit（次の指示）で消える
//   stoppedAt   : 印を付けた時刻（ms）。10 分の保険（notify_watcher.js）が「同じ印か」を確かめるのに使う
//   notified    : この印に対して通知済みか
//   chain, cwd  : 通知の表示位置とプロジェクト名（Stop 時に保存）
//
// 状態は %LOCALAPPDATA%\dev-guard\sessions\<session_id>.json。
// 複数の hook が同時に走る（並列 Agent 起動など）ので、mkdir によるロックで読み書きを直列化する。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getAncestorChain, launchDetached, notifyDone } = require("./common");

const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "dev-guard", "sessions");
const LOCK_STALE_MS = 10000;
const FALLBACK_SECONDS = Number(process.env.DEV_GUARD_FALLBACK_SECONDS) || 600; // 印から 10 分

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

// サブエージェント終了（SubagentStop）。本体が既に止まっていて最後の 1 つなら、ここで通知する。
function agentStopped(sessionId) {
  const fire = withState(sessionId, (s) => {
    s.agents = Math.max(0, s.agents - 1);
    if (shouldNotify(s)) { s.notified = true; return { cwd: s.cwd, chain: s.chain }; }
    return null;
  });
  if (fire) notifyDone(fire.cwd || process.cwd(), fire.chain);
}

// 本体停止（Stop フックの最後）。残り 0 なら即通知、残りがあれば保留して 10 分の保険を仕掛ける。
function mainStopped(sessionId, cwd) {
  const chain = getAncestorChain();
  const now = Date.now();
  const r = withState(sessionId, (s) => {
    // Stop フックが二重登録されている等で数秒内に 2 回呼ばれても、通知は 1 回にする
    if (s.mainStopped && now - s.stoppedAt < 3000) return "duplicate";
    s.mainStopped = true;
    s.stoppedAt = now;
    s.notified = false;
    s.chain = chain;
    s.cwd = cwd;
    if (shouldNotify(s)) { s.notified = true; return "now"; }
    return "pending";
  });
  if (r === "now") {
    notifyDone(cwd, chain);
  } else if (r === "pending") {
    process.stdout.write("dev-guard: 裏で動くエージェントが残っているため、通知は全部終わってから出します。\n");
    launchDetached(process.execPath, [
      path.join(__dirname, "notify_watcher.js"), String(sessionId), String(now), String(FALLBACK_SECONDS),
    ]);
  }
  return r;
}

// 10 分の保険（notify_watcher.js から）。印が同じままで未通知なら 1 回だけ通知する。
function fallbackNotify(sessionId, stoppedAt) {
  const fire = withState(sessionId, (s) => {
    if (s.mainStopped && s.stoppedAt === stoppedAt && !s.notified) {
      s.notified = true;
      return { cwd: s.cwd, chain: s.chain, agents: s.agents };
    }
    return null;
  });
  if (fire) notifyDone(fire.cwd || process.cwd(), fire.chain);
  return !!fire;
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
  STATE_DIR, stateFile, withState, agentStarted, agentStopped, mainStopped, fallbackNotify,
  turnStarted, sessionEnded, pruneOld,
};
