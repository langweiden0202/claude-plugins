# dev-guard 変更履歴

## 1.1.0 (2026-09-19)
- 作業終了の通知（音＋ポップアップ）を Stop フックの最後に組み込んだ（`scripts/notify.ps1`）
  - テスト確認がすべて済み「終了してよい」と判断したときだけ 1 回鳴る。テスト失敗で差し戻す（exit 2）ときは鳴らない
  - ポップアップは「<プロジェクト名> の作業が終わりました」＋完了時刻。クリックで閉じる、放置なら 5 分で自動で閉じる
  - キー入力のフォーカスを奪わない（WS_EX_NOACTIVATE）。白背景・大きめの文字
  - 表示位置は、フックを動かしている Claude Code の窓（Cursor／ターミナル）の中央。親プロセスをたどって探し、
    無ければ窓タイトルにプロジェクト名を含む窓、それも無ければ画面中央。決め方をログに 1 行残す
    （`%LOCALAPPDATA%\dev-guard\notify.log`）
  - 試験モード（`-TestMode` または環境変数 `DEV_GUARD_NOTIFY_TEST=1`）: ポップアップも音も出さず、
    notify.log に「would-notify（鳴らすはずだった）」と書くだけ。通知しない場面も理由（hold／skip）を同じログに残す
  - `~/.claude/settings.json` 側の Stop フック通知は不要になった（通知は dev-guard の 1 か所だけ）
- 通知は「本当に全部終わった時」に 1 回だけ。裏で動くサブエージェント（Agent の run_in_background、
  code-reviewer 等）が残っていれば本体が止まっても鳴らさず、最後の 1 つが終わった時（SubagentStop）に鳴らす
  - PreToolUse(Agent|Task) で +1、SubagentStop で -1 を `%LOCALAPPDATA%\dev-guard\sessions\<session_id>.json` に記録
  - Stop で「本体停止」の印。残り 0 なら即通知、残りがあれば保留。UserPromptSubmit（次の指示）で印を消す
  - 数え漏れ対策: 印から 10 分たっても未通知なら 1 回だけ鳴らす（`notify_watcher.js`）
  - 数秒内の二重 Stop（フックの二重登録など）は 1 回にまとめる
- 終了前テストは作業ツリーの `.venv\Scripts\python.exe` を優先して使う。無いときだけ PATH の python。
  使った Python のパスをフックの出力に 1 行書く（「No module named pytest」の再発防止）
- `stop_hook_active`（差し戻し後の再停止）でもテストは再実行しないが、通知は出す

## 1.0.4 (2026-09-08)
- 長い処理を待つ間も番を終えず待機を繰り返すルールを追加

## 1.0.3 (2026-09-04)
- 複数段階作業を自律的に進めるルールを追加

## 1.0.2 (2026-08-24)
- .NET リポジトリで終了前テストが誤検知するのを修正（`dotnet test` を先に見る。pytest の「0 件」を失敗にしない）

## 1.0.1 (2026-08-23)
- レビュー観点に「GUI 配布ビルドでは stdout/stderr が None。print 禁止」を追加

## 1.0.0 (2026-08-22)
- 初版: 共通ルール注入（SessionStart）・保存時の構文チェック（PostToolUse）・終了前テスト（Stop）・
  レビュー用サブエージェント・`/dev-guard:review`・`/dev-guard:verify`
