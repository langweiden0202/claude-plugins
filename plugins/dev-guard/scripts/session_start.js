// SessionStart: 共通ルールを標準出力に流す → Claude の文脈に入る（プラグイン直下の CLAUDE.md は読まれないため）
const fs = require("fs");
const path = require("path");
const rules = fs.readFileSync(path.join(__dirname, "..", "skills", "dev-rules", "SKILL.md"), "utf8");
const body = rules.replace(/^---[\s\S]*?---\s*/, "");
process.stdout.write("## dev-guard 共通ルール（自動注入）\n" + body);
