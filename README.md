# codescan-mcp

MCP server that scans your codebase for TODOs, FIXMEs, code complexity, file stats, dependency analysis, and generates a health report with a letter grade. Zero config, zero API keys.

## Install

```bash
npx codescan-mcp
```

No config files. No API keys. Works on any local project directory.

## Tools

### `scan_todos` — Find all TODOs, FIXMEs, HACKs
```
"Find all TODOs in this project"
"Show me every FIXME and HACK in my codebase"
"What TODOs are in /path/to/project?"
```
Scans every code file, returns tag, file, line number, and text. Groups by tag type.

### `project_stats` — Codebase statistics
```
"How many lines of code are in this project?"
"Show file count by language"
"What are the largest files?"
```
Files by extension, line counts, size, directory breakdown, largest files ranked.

### `find_complex_files` — Complexity detector
```
"Find files over 300 lines"
"Which files have the deepest nesting?"
"Show me complex files that need refactoring"
```
Flags long files, deep nesting, and long functions. Configurable threshold.

### `check_dependencies` — Dependency analysis
```
"How many dependencies does this project have?"
"Is there a lockfile?"
"List all npm packages this project uses"
```
Supports: package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml.

### `health_report` — Full health report with letter grade
```
"Give me a health report for this project"
"Grade this codebase"
"How healthy is this project?"
```
Combines all analyses into a single report with an A-F grade, scores, and actionable recommendations.

## Configuration

### Claude Desktop / Claude Code
```json
{
  "mcpServers": {
    "codescan": {
      "command": "npx",
      "args": ["codescan-mcp"]
    }
  }
}
```

### Cursor
Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "codescan": {
      "command": "npx",
      "args": ["codescan-mcp"]
    }
  }
}
```

### Windsurf
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "codescan": {
      "command": "npx",
      "args": ["codescan-mcp"]
    }
  }
}
```

## What It Scans

- **35+ file types**: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, Ruby, PHP, Swift, Kotlin, Vue, Svelte, and more
- **Smart ignore**: Skips node_modules, .git, dist, build, __pycache__, vendor, and other non-source directories
- **Performance**: Handles projects up to 5,000 files, skips files over 500KB

## Token Cost

| Tool | Tokens |
|------|--------|
| scan_todos | ~550 |
| project_stats | ~550 |
| find_complex_files | ~550 |
| check_dependencies | ~550 |
| health_report | ~550 |
| **Total** | **~2,750** |

## Part of the MCP Toolkit

**[View all servers →](https://yifanyifan897645.github.io/mcp-toolkit/)**

- [webcheck-mcp](https://www.npmjs.com/package/webcheck-mcp) — Website health analysis
- [git-summary-mcp](https://www.npmjs.com/package/git-summary-mcp) — Git repository intelligence
- [mcp-checkup](https://www.npmjs.com/package/mcp-checkup) — MCP setup health analyzer
- [dev-utils-mcp](https://www.npmjs.com/package/dev-utils-mcp) — Developer utilities
- [codescan-mcp](https://www.npmjs.com/package/codescan-mcp) — Codebase health scanner

---

Want to build and monetize your own MCP servers? Check out the [development kit](https://ifdian.net/item/fdfddfb02c1311f1ae625254001e7c00).

## License

MIT
