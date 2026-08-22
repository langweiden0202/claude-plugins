---
name: verify
description: 「できました」と言う前の最終確認。テスト・構文・未コミット変更・秘密情報の混入を機械的に確認して結果を表にする。
---
次を順に実行し、結果を1つの表にまとめてください（項目／結果／備考）。

1. テスト: tests/ があれば `python -m pytest tests -q`、package.json に test があれば `npm test`
2. 構文: 変更した .py は `python -m py_compile`、.js/.ts は `node --check`
3. 未コミット: `git status --short` に残りがあれば一覧
4. 秘密情報: `git diff` と変更ファイルに API キー・パスワード・トークンらしき文字列が無いか grep
5. 仕様との整合: CLAUDE.md や docs/ の仕様書に書かれた「やってはいけないこと」に触れていないか

1つでも NG があれば、直してからもう一度この手順を実行してください。
