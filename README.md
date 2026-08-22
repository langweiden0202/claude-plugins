# yuu-plugins — 個人用 Claude Code プラグイン集

## dev-guard
| 種類 | 名前 | 何をするか |
|---|---|---|
| フック | SessionStart | 共通ルール（dev-rules）をセッション開始時に自動注入 |
| フック | PostToolUse | `.py` を書き換えるたびに構文チェック。壊れていたら差し戻し |
| フック | Stop | 「終わりました」の直前に pytest / npm test。失敗なら終われない |
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
確認: `/plugin` で dev-guard が enabled、`/hooks` でフック3件。

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
- Python 3（`python3` または `python` が PATH にあること。無ければ構文チェックと pytest は静かにスキップ）
