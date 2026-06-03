# TTL - Tera Term Language Support for VS Code

VSCode extension providing language support for TTL (Tera Term Language), the macro language of [Tera Term](https://teratermproject.github.io/).

## Features

- **Syntax Highlighting** — keywords, commands, strings, comments, labels, operators, system variables
- **Code Completion** — 201 built-in commands with signatures and documentation
- **Hover Documentation** — inline reference for commands in Japanese or English
- **Go to Definition** — jump from `goto`/`call` to `:label` definitions

## Language Setting

By default the extension detects the VS Code UI language and shows Japanese or English documentation automatically. Override via settings:

```json
"ttl.language": "auto"  // "auto" | "ja" | "en"
```

## Supported Syntax

| Syntax | Example |
|--------|---------|
| Line comment | `; this is a comment` |
| Block comment | `/* ... */` |
| String | `'hello'` |
| Label definition | `:loop_start` |
| Control flow | `if`, `for`, `while`, `do`, `goto`, `call`, `return` |
| System variables | `result`, `inputstr`, `matchstr`, `param1`–`param9` |

## Requirements

VS Code 1.85.0 or later.

## Development

```sh
npm install
npm run compile
# Unit tests (Vitest, no VS Code required)
npm test
# Integration tests (requires GUI / CI with xvfb)
npm run test:integration
```

## License

MIT
