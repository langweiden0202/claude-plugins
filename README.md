# yuu-plugins — 個人用 Claude Code プラグイン集

## dev-guard
| 種類 | 名前 | 何をするか |
|---|---|---|
| フック | SessionStart | 共通ルール（dev-rules）をセッション開始時に自動注入 |
| フック | PostToolUse | `.py` を書き換えるたびに構文チェック。壊れていたら差し戻し |
| フック | Stop | 「終わりました」の直前に dotnet test / pytest（作業ツリーの `.venv` を優先）/ npm test。失敗なら終われない。通ったら音とポップアップで 1 回だけ知らせる（Windows。`scripts/notify.ps1`） |
| フック | PreToolUse(Agent) / SubagentStop / UserPromptSubmit / SessionEnd | 裏で動くサブエージェントを数え、全部終わってから通知を 1 回だけ出す（`scripts/agent_track.js`） |
| スキル | `/dev-guard:review` | code-reviewer でレビューして重大・要修正を直す |
| スキル | `/dev-guard:verify` | テスト・構文・未コミット・秘密情報の最終確認 |
| エージェント | `dev-guard:code-reviewer` | 読み取り専用のレビュアー |

## 導入（各PCで1回）
Claude Code の中で:
```
/plugin marketplace add https://github.com/langweiden0202/claude-plugins.git
/plugin install dev-guard@yuu-plugins
/reload-plugins
```
確認: `/plugin` で dev-guard が enabled、`/hooks` でフック7件。

## 更新したいとき
1. このリポジトリを直して `plugins/dev-guard/.claude-plugin/plugin.json` の `version` を上げる（例 1.0.0 → 1.0.1）
2. commit / push
3. 各PCで `/plugin marketplace update yuu-plugins` → `/plugin update dev-guard@yuu-plugins`

## クラウド環境（clone した先で自動有効化したいとき）
そのプロジェクトの `.claude/settings.json` に:
```json
{
  "extraKnownMarketplaces": {
    "yuu-plugins": { "source": { "source": "url", "url": "https://github.com/langweiden0202/claude-plugins.git" } }
  },
  "enabledPlugins": { "dev-guard@yuu-plugins": true }
}
```

## 動作の前提
- Node.js（Claude Code に必須なので必ずある）
- Python 3（作業ツリーの `.venv\Scripts\python.exe` → `python3` → `python` の順で探す。無ければ構文チェックと pytest は静かにスキップ）
- 終了通知は Windows のみ（PowerShell 5.1 + Windows Forms）。位置決めのログは `%LOCALAPPDATA%\dev-guard\notify.log`。
  手動確認は試験モード（ポップアップも音も出さず、ログに would-notify と書くだけ）: `DEV_GUARD_NOTIFY_TEST=1` を付けてフックを実行するか、`notify.ps1 -TestMode`。
  通知した／保留した／見送った理由も同じログに 1 行ずつ残る
- `~/.claude/settings.json` には通知用の Stop / Notification フックを置かない（二重に鳴る）
