# Contributing

## Run locally

```bash
npm install
npm test
```

Press **F5** in Cursor or VS Code to launch an Extension Development Host.

## Notes

- Keep `tf` parsers in `src/tf/` free of the `vscode` module so unit tests can run in Node.
- Do not log passwords. Login flags are redacted in the TFVC output channel.
- Prefer small, reviewable PRs.

## Layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | Activation, watchers, auto-checkout |
| `src/tf/` | Locate and run `tf`, parse status/workfold/history |
| `src/scm/` | Source Control provider, diffs, decorations |
| `src/commands.ts` | Command Palette / SCM / explorer actions |
