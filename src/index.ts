#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

const server = new McpServer({
  name: "codehealth",
  version: "0.1.0",
});

// Common ignore patterns
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".cache",
  "coverage", ".nyc_output", "__pycache__", ".venv", "venv", "vendor",
  ".idea", ".vscode", ".svn", "target", "bin", "obj", ".nuxt", ".output",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp",
  ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".kt", ".scala", ".vue",
  ".svelte", ".astro", ".html", ".css", ".scss", ".less", ".sql", ".sh",
  ".bash", ".zsh", ".yaml", ".yml", ".toml", ".json", ".xml", ".md",
  ".mdx", ".r", ".R", ".lua", ".dart", ".ex", ".exs", ".zig", ".nim",
]);

interface FileInfo {
  path: string;
  lines: number;
  size: number;
  ext: string;
}

async function walkDir(dir: string, maxFiles = 5000): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  async function walk(current: string, depth: number) {
    if (depth > 20 || files.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name) && entry.isDirectory()) continue;

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!CODE_EXTENSIONS.has(ext)) continue;
        try {
          const s = await stat(fullPath);
          if (s.size > 500_000) continue; // skip files > 500KB
          const content = await readFile(fullPath, "utf-8");
          files.push({
            path: relative(dir, fullPath).replace(/\\/g, "/"),
            lines: content.split("\n").length,
            size: s.size,
            ext,
          });
        } catch { /* skip unreadable files */ }
      }
    }
  }

  await walk(dir, 0);
  return files;
}

// Tool 1: Scan TODOs, FIXMEs, HACKs
server.tool(
  "scan_todos",
  "Find all TODO, FIXME, HACK, XXX, BUG, and OPTIMIZE comments in the codebase with file, line, and context",
  {
    directory: z.string().describe("Absolute path to the project directory"),
    tags: z.array(z.string()).default(["TODO", "FIXME", "HACK", "XXX", "BUG", "OPTIMIZE"]).describe("Comment tags to search for"),
  },
  async ({ directory, tags }) => {
    const files = await walkDir(directory);
    const pattern = new RegExp(`\\b(${tags.join("|")})[:\\s](.*)`, "gi");
    const results: { file: string; line: number; tag: string; text: string }[] = [];

    for (const f of files) {
      try {
        const content = await readFile(join(directory, f.path), "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const matches = lines[i].matchAll(pattern);
          for (const m of matches) {
            results.push({
              file: f.path,
              line: i + 1,
              tag: m[1].toUpperCase(),
              text: m[2].trim(),
            });
          }
        }
      } catch { /* skip */ }
    }

    const byTag: Record<string, number> = {};
    for (const r of results) byTag[r.tag] = (byTag[r.tag] || 0) + 1;

    const output = {
      total: results.length,
      byTag,
      items: results.slice(0, 200), // limit output
      truncated: results.length > 200,
      filesScanned: files.length,
    };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
  }
);

// Tool 2: Project stats
server.tool(
  "project_stats",
  "Get codebase statistics: files by language, line counts, largest files, directory breakdown",
  {
    directory: z.string().describe("Absolute path to the project directory"),
  },
  async ({ directory }) => {
    const files = await walkDir(directory);
    const totalLines = files.reduce((s, f) => s + f.lines, 0);
    const totalSize = files.reduce((s, f) => s + f.size, 0);

    // By extension
    const byExt: Record<string, { files: number; lines: number; size: number }> = {};
    for (const f of files) {
      if (!byExt[f.ext]) byExt[f.ext] = { files: 0, lines: 0, size: 0 };
      byExt[f.ext].files++;
      byExt[f.ext].lines += f.lines;
      byExt[f.ext].size += f.size;
    }

    // By top-level directory
    const byDir: Record<string, { files: number; lines: number }> = {};
    for (const f of files) {
      const dir = f.path.includes("/") ? f.path.split("/")[0] : "(root)";
      if (!byDir[dir]) byDir[dir] = { files: 0, lines: 0 };
      byDir[dir].files++;
      byDir[dir].lines += f.lines;
    }

    // Largest files
    const largest = [...files].sort((a, b) => b.lines - a.lines).slice(0, 15);

    const output = {
      totalFiles: files.length,
      totalLines,
      totalSizeKB: Math.round(totalSize / 1024),
      byExtension: Object.fromEntries(
        Object.entries(byExt).sort((a, b) => b[1].lines - a[1].lines)
      ),
      byDirectory: Object.fromEntries(
        Object.entries(byDir).sort((a, b) => b[1].lines - a[1].lines).slice(0, 20)
      ),
      largestFiles: largest.map(f => ({ path: f.path, lines: f.lines, sizeKB: Math.round(f.size / 1024) })),
    };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
  }
);

// Tool 3: Find long/complex files
server.tool(
  "find_complex_files",
  "Find files that are unusually long, deeply nested, or have high complexity indicators",
  {
    directory: z.string().describe("Absolute path to the project directory"),
    lineThreshold: z.number().default(300).describe("Flag files longer than this many lines"),
  },
  async ({ directory, lineThreshold }) => {
    const files = await walkDir(directory);
    const results: {
      path: string;
      lines: number;
      flags: string[];
      nestingDepth: number;
    }[] = [];

    for (const f of files) {
      if (f.lines < lineThreshold && f.path.split("/").length <= 5) continue;
      const flags: string[] = [];
      if (f.lines >= lineThreshold) flags.push(`${f.lines} lines (threshold: ${lineThreshold})`);

      // Check nesting depth and complexity signals
      try {
        const content = await readFile(join(directory, f.path), "utf-8");
        const lines = content.split("\n");

        let maxIndent = 0;
        let longFunctions = 0;
        let braceDepth = 0;
        let funcStartLine = -1;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const indent = line.search(/\S/);
          if (indent > maxIndent && indent < 100) maxIndent = indent;

          // Track brace depth for function length estimation
          for (const ch of line) {
            if (ch === "{") {
              braceDepth++;
              if (braceDepth === 1) funcStartLine = i;
            }
            if (ch === "}") {
              if (braceDepth === 1 && funcStartLine >= 0) {
                const funcLen = i - funcStartLine;
                if (funcLen > 50) longFunctions++;
              }
              braceDepth = Math.max(0, braceDepth - 1);
            }
          }
        }

        if (maxIndent >= 20) flags.push(`deep nesting (max indent: ${maxIndent} chars)`);
        if (longFunctions > 0) flags.push(`${longFunctions} long function(s) (>50 lines)`);

        if (flags.length > 0) {
          results.push({
            path: f.path,
            lines: f.lines,
            flags,
            nestingDepth: f.path.split("/").length,
          });
        }
      } catch { /* skip */ }
    }

    results.sort((a, b) => b.lines - a.lines);

    const output = {
      complexFiles: results.length,
      threshold: lineThreshold,
      files: results.slice(0, 50),
      filesScanned: files.length,
    };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
  }
);

// Tool 4: Dependency check (package.json / requirements.txt analysis)
server.tool(
  "check_dependencies",
  "Analyze project dependencies: count, outdated signals, duplicate lockfiles, missing lockfiles",
  {
    directory: z.string().describe("Absolute path to the project directory"),
  },
  async ({ directory }) => {
    const results: any = { manifests: [] };

    // Check for package.json
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf-8"));
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      const peerDeps = Object.keys(pkg.peerDependencies || {});

      let hasLockfile = false;
      try { await stat(join(directory, "package-lock.json")); hasLockfile = true; } catch {}
      try { await stat(join(directory, "yarn.lock")); hasLockfile = true; } catch {}
      try { await stat(join(directory, "pnpm-lock.yaml")); hasLockfile = true; } catch {}
      try { await stat(join(directory, "bun.lockb")); hasLockfile = true; } catch {}

      results.manifests.push({
        type: "package.json",
        dependencies: deps.length,
        devDependencies: devDeps.length,
        peerDependencies: peerDeps.length,
        total: deps.length + devDeps.length + peerDeps.length,
        hasLockfile,
        allDeps: [...deps.map(d => `  ${d}: ${pkg.dependencies[d]}`),
                  ...devDeps.map(d => `  ${d}: ${pkg.devDependencies[d]} (dev)`)],
      });
    } catch { /* no package.json */ }

    // Check for requirements.txt
    try {
      const content = await readFile(join(directory, "requirements.txt"), "utf-8");
      const deps = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));
      results.manifests.push({
        type: "requirements.txt",
        dependencies: deps.length,
        items: deps,
      });
    } catch { /* no requirements.txt */ }

    // Check for pyproject.toml
    try {
      const content = await readFile(join(directory, "pyproject.toml"), "utf-8");
      const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depMatch) {
        const deps = depMatch[1].split("\n").filter(l => l.trim().startsWith('"')).length;
        results.manifests.push({ type: "pyproject.toml", dependencies: deps });
      }
    } catch { /* no pyproject.toml */ }

    // Check for go.mod
    try {
      const content = await readFile(join(directory, "go.mod"), "utf-8");
      const requires = content.match(/require\s*\(([\s\S]*?)\)/);
      const deps = requires ? requires[1].split("\n").filter(l => l.trim()).length : 0;
      results.manifests.push({ type: "go.mod", dependencies: deps });
    } catch { /* no go.mod */ }

    // Check for Cargo.toml
    try {
      const content = await readFile(join(directory, "Cargo.toml"), "utf-8");
      const depsSection = content.match(/\[dependencies\]([\s\S]*?)(\[|$)/);
      const deps = depsSection ? depsSection[1].split("\n").filter(l => l.includes("=")).length : 0;
      results.manifests.push({ type: "Cargo.toml", dependencies: deps });
    } catch { /* no Cargo.toml */ }

    if (results.manifests.length === 0) {
      results.message = "No dependency manifests found (checked: package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml)";
    }

    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// Tool 5: Health report (aggregate)
server.tool(
  "health_report",
  "Generate a full codebase health report: stats, TODOs, complexity, dependencies, and a letter grade",
  {
    directory: z.string().describe("Absolute path to the project directory"),
  },
  async ({ directory }) => {
    const files = await walkDir(directory);
    const totalLines = files.reduce((s, f) => s + f.lines, 0);
    const totalSize = files.reduce((s, f) => s + f.size, 0);

    // Count TODOs
    const todoPattern = /\b(TODO|FIXME|HACK|XXX|BUG)\b/gi;
    let todoCount = 0;
    const todoSample: string[] = [];
    for (const f of files) {
      try {
        const content = await readFile(join(directory, f.path), "utf-8");
        const matches = content.match(todoPattern);
        if (matches) {
          todoCount += matches.length;
          if (todoSample.length < 5) {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && todoSample.length < 5; i++) {
              if (todoPattern.test(lines[i])) {
                todoSample.push(`${f.path}:${i + 1}: ${lines[i].trim()}`);
              }
              todoPattern.lastIndex = 0;
            }
          }
        }
      } catch { /* skip */ }
    }

    // Count large files
    const largeFiles = files.filter(f => f.lines > 300).length;

    // Extensions breakdown
    const byExt: Record<string, number> = {};
    for (const f of files) byExt[f.ext] = (byExt[f.ext] || 0) + 1;
    const topLangs = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Calculate grade
    let score = 100;
    const todoRatio = todoCount / Math.max(files.length, 1);
    if (todoRatio > 1) score -= 20;
    else if (todoRatio > 0.5) score -= 10;
    else if (todoRatio > 0.2) score -= 5;

    const largeRatio = largeFiles / Math.max(files.length, 1);
    if (largeRatio > 0.2) score -= 20;
    else if (largeRatio > 0.1) score -= 10;
    else if (largeRatio > 0.05) score -= 5;

    if (files.length === 0) score = 0;

    const avgLines = files.length > 0 ? Math.round(totalLines / files.length) : 0;
    if (avgLines > 200) score -= 10;
    else if (avgLines > 100) score -= 5;

    const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

    const report = {
      grade,
      score,
      summary: {
        files: files.length,
        totalLines,
        totalSizeKB: Math.round(totalSize / 1024),
        avgLinesPerFile: avgLines,
        topLanguages: topLangs.map(([ext, count]) => `${ext} (${count} files)`),
      },
      todos: {
        count: todoCount,
        ratio: `${todoRatio.toFixed(2)} per file`,
        sample: todoSample,
      },
      complexity: {
        largeFiles: `${largeFiles} files over 300 lines`,
        largeFileRatio: `${(largeRatio * 100).toFixed(1)}%`,
      },
      recommendations: [] as string[],
    };

    if (todoCount > 10) report.recommendations.push(`Address ${todoCount} TODO/FIXME comments — prioritize FIXMEs`);
    if (largeFiles > 3) report.recommendations.push(`${largeFiles} files exceed 300 lines — consider splitting`);
    if (avgLines > 150) report.recommendations.push(`Average file length (${avgLines}) is high — aim for <150`);
    if (report.recommendations.length === 0) report.recommendations.push("Codebase looks healthy!");

    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
