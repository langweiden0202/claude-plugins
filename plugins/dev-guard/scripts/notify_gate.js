// 「本当に全部終わったときだけ鳴らす」ための関門（1.3.0）。
//
// Stop フックは「返答を書き終えるたび」に呼ばれる。バックグラウンドの待ち・Monitor の起床・
// サブエージェントやワークツリー単位の区切りでも返答は一度終わるので、そのたびに
// 「作業が終わりました」が鳴っていた（2026-09-20 に 3 回以上再発）。
// そこで、フックが受け取る transcript（会話の記録）を読み、**最後のアシスタントの返答に
// 完了の目印が入っているときだけ**鳴らす。目印は返答を書く側（CLAUDE.md の恒久ルール）が
// 最終報告にだけ入れる:
//   ・「動作確認できます」 … 開発版の完了報告
//   ・「完成です」         … インストーラー完了報告
//   ・「【完了】」         … 汎用の完了の目印
//   ・「【判断待ち】」     … ユーザーの判断がないと進めないとき
// それ以外の返答終わりでは一切鳴らさない。
const fs = require("fs");

const DONE_MARKS = ["動作確認できます", "完成です", "【完了】", "【判断待ち】"];

/** transcript（JSONL）から、最後のアシスタントの返答の本文（text ブロックをつないだもの）を取り出す */
function lastAssistantText(transcriptPath) {
  let raw = "";
  try { raw = fs.readFileSync(transcriptPath, "utf8"); } catch { return ""; }
  let last = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const msg = rec && rec.message;
    if (!msg || (rec.type !== "assistant" && msg.role !== "assistant")) continue;
    const content = msg.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
    }
    // ツール呼び出しだけの返答（本文なし）は「最後の返答」とみなさない
    if (text.trim()) last = text;
  }
  return last;
}

/** 目印が入っているか。入っていれば、どの目印かを返す（無ければ ""） */
function doneMarkIn(text) {
  const t = String(text || "");
  return DONE_MARKS.find((m) => t.includes(m)) || "";
}

/**
 * 鳴らしてよいか。
 * @returns {{notify:boolean, mark:string, why:string}}
 */
function decide(transcriptPath) {
  if (!transcriptPath) return { notify: false, mark: "", why: "transcript が渡されていない" };
  const text = lastAssistantText(transcriptPath);
  if (!text) return { notify: false, mark: "", why: "最後の返答の本文が読めない" };
  const mark = doneMarkIn(text);
  if (!mark) return { notify: false, mark: "", why: "完了の目印（動作確認できます／完成です／【完了】／【判断待ち】）が無い＝途中経過" };
  return { notify: true, mark, why: `完了の目印「${mark}」あり` };
}

module.exports = { DONE_MARKS, lastAssistantText, doneMarkIn, decide };
