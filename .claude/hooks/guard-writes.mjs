#!/usr/bin/env node
// PreToolUse guard for Claude Code's file-writing tools (Write, Edit, NotebookEdit):
// refuses any write whose resolved path is outside this project directory.
// A second layer on top of the orion-dev Linux account restrictions (D9).
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) process.exit(0);

const project = realpathSync(process.env.CLAUDE_PROJECT_DIR || input.cwd);

// Resolve symlinks on the nearest existing ancestor so a link can't point a write elsewhere.
function resolve(p) {
  const abs = path.resolve(input.cwd || project, p);
  let dir = abs;
  const rest = [];
  while (true) {
    try {
      return path.join(realpathSync(dir), ...rest);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return abs;
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

const resolved = resolve(target);
if (resolved === project || resolved.startsWith(project + path.sep)) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `Writes are limited to ${project}; refused: ${resolved}`,
  },
}));
