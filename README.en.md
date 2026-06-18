# TTL - Tera Term Language Support for VS Code

*English | [日本語](README.md)*

[Tera Term](https://teratermproject.github.io/) macro language (TTL) support extension for Visual Studio Code.

> Tera Term is a work of the [TeraTerm Project](https://github.com/TeraTermProject/teraterm). This is an unofficial extension and is not affiliated with the TeraTerm Project.

## Features

- **Syntax Highlighting** — keywords, commands, strings, comments, labels, operators, system variables
- **Code Completion** — 201 built-in commands with signatures and documentation
- **Hover Documentation** — inline reference in Japanese or English
- **Go to Definition** — jump from `goto`/`call` to `:label` definitions; falls back to (recursively) searching `include`d files (F12)
- **Find All References** — list a label's definition and references (`goto`/`call`) (Shift+F12)
- **Outline / Symbols** — labels and `include`s shown in breadcrumbs, outline, and symbol search (Ctrl+Shift+O)
- **Include Links** — Ctrl+click the path in `include 'path'` to open the file. As in Tera Term, relative paths are resolved against the directory of the **top-level parent macro** (auto-detected by scanning the workspace; can be fixed via `ttl.includeRootDir`)
- **Run Macro (debug config)** — **TTL Macro (Tera Term)** appears in launch.json's "Add Configuration", and F5 / ▶ runs the current macro with Tera Term. Describe the connection (SSH / Telnet / serial) with a structured `connect` object ([usage](#running-macros))
- **Code Formatting** — auto-indent based on block structures such as `if`/`for`/`while`/`do`, plus alignment of Markdown tables written inside comments (full-width aware) (Shift+Alt+F)
- **Diagnostics (Errors/Warnings)** — detects invalid operators (`&&`, `++`, `+=`, etc.), assignments to system variables (e.g. `result`), a single `=` used for comparison (suggests `==`), unclosed blocks (missing `endif`/`next`, etc.), excessive nesting (default depth 2, configurable via `ttl.maxNestingDepth`), unknown commands (suggests the closest command), `goto`/`call` to undefined labels (includes resolved), and duplicate label definitions

## Language Setting

The extension auto-detects the VS Code UI language. Override in settings:

```json
"ttl.language": "auto"  // "auto" | "ja" | "en"
```

The maximum nesting depth before a warning is also configurable (default 2, 0 disables it):

```json
"ttl.maxNestingDepth": 2
```

Individual diagnostics can be toggled (all default `true`):

```json
"ttl.diagnostics.undefinedLabel": true,
"ttl.diagnostics.unknownCommand": true,
"ttl.diagnostics.duplicateLabel": true
```

The base directory for resolving include links can be fixed. When empty (default), the top-level parent macro is auto-detected by scanning the workspace. A relative path is resolved against the workspace folder; an absolute path is used as-is.

```json
"ttl.includeRootDir": ""
```

## Running Macros

Run macros as a debug configuration. In the **Run and Debug** view, "create a launch.json file" → pick **TTL Macro (Tera Term)**, or use "Add Configuration" in `launch.json`. Launch with F5 or ▶ (requires Windows + Tera Term).

Describe the connection with a structured `connect` object; the extension translates it to Tera Term CLI options. Omit `connect` to launch without connecting (the macro's own `connect` handles it).

```jsonc
// SSH
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (SSH)",
  "program": "${file}",            // macro to run
  "connect": {
    "proto": "ssh",                // "ssh" | "telnet" | "serial"
    "host": "192.168.0.100",
    "port": 22,
    "options": ["/auth=password", "/user=admin"]  // extra raw options
  },
  "teraTermDir": ""                 // auto-detected when empty
}
// → ttermpro.exe 192.168.0.100:22 /ssh /auth=password /user=admin /M=<file>
```

```jsonc
// Serial
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro (Serial)",
  "program": "${file}",
  "connect": {
    "proto": "serial",
    "comport": 3,        // COM port (1–256)
    "speed": 115200,     // baud
    "cdatabit": 8,       // 7 | 8
    "cparity": "none",   // none | odd | even | mark | space
    "cstopbit": 1,       // 1 | 1.5 | 2
    "cflowctrl": "hard"  // x | hard | none | rtscts | dsrdtr
  }
}
// → ttermpro.exe /C=3 /BAUD=115200 /CDATABIT=8 /CPARITY=none /CSTOPBIT=1 /CFLOWCTRL=hard /M=<file>
```

Use `${input:ttlHost}` for `connect.host` (with an `inputs` entry) to prompt for the host on each run:

```jsonc
{
  "configurations": [
    { "type": "ttl", "request": "launch", "name": "Run TTL Macro (prompt host)",
      "program": "${file}", "connect": { "proto": "ssh", "host": "${input:ttlHost}", "port": 22 } }
  ],
  "inputs": [
    { "id": "ttlHost", "type": "promptString", "description": "Host (e.g. 192.168.0.100)" }
  ]
}
```

### Other options

Non-connection Tera Term options can be set at the top level of the configuration (descriptions are shown in Japanese or English depending on the VS Code display language).

| key | Tera Term | description |
|---|---|---|
| `windowTitle` | `/W=` | Window title |
| `setupFile` | `/F=` | Setup file |
| `keyboardFile` | `/K=` | Keyboard setup file |
| `logFile` / `noLog` | `/L=` / `/NOLOG` | Start logging / no log |
| `replayFile` | `/R=` | Replay file |
| `fileTransferDir` | `/FD=` | File transfer dir |
| `theme` | `/THEME=` | Theme file |
| `vtIcon` / `tekIcon` | `/VTICON=` / `/TEKICON=` | Window icons |
| `hideTitleBar` / `iconify` / `hidden` | `/H` / `/I` / `/V` | Hide title bar / iconify / hidden launch |
| `windowX` / `windowY` | `/X=` / `/Y=` | Window position |
| `kanjiReceive` / `kanjiTransmit` | `/KR=` / `/KT=` | Kanji code receive/transmit |
| `multicastName` | `/MN=` | Multicast name |
| `osc52` | `/OSC52=` | Clipboard access |
| `autoWinClose` | `/AUTOWINCLOSE=` | Auto close on disconnect |
| `disableLocalEcho` | `/E` | Disable local echo |
| `newConnectionDialog` | `/ES` `/DS` | Show/hide new connection dialog |

The connection side (`connect`) also supports `binary`(`/B`), `waitcom`(`/WAITCOM`), `timeout`(`/TIMEOUT=`), and `proto: "namedpipe"`(`/PIPE`). Options not covered by the schema can be written raw in `connect.options`.

```jsonc
{
  "type": "ttl", "request": "launch", "name": "Run TTL Macro",
  "program": "${file}",
  "connect": { "proto": "ssh", "host": "192.168.0.100", "port": 22, "timeout": 15 },
  "windowTitle": "Deploy", "logFile": "${workspaceFolder}/session.log", "hidden": false
}
```

## Supported Syntax

| Syntax | Example |
|------|----|
| Line comment | `; comment` |
| Block comment | `/* ... */` |
| String | `'hello'` |
| Label definition | `:loop_start` |
| Control flow | `if`, `for`, `while`, `do`, `goto`, `call`, `return` |
| System variables | `result`, `inputstr`, `matchstr`, `param1`–`param9` |

## Requirements

- **Visual Studio Code**: 1.120.0 or later
- **OS**: Windows (Required only for the macro execution feature. Language support features like syntax highlighting, code completion, and diagnostics work on macOS / Linux as well)
- **Additional Software**: [Tera Term](https://teratermproject.github.io/) 4 or 5 (Required only for the macro execution feature to locate `ttermpro.exe`)


## License

MIT
