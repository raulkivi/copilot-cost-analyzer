// Pure helper for the tool-call audit (docs/plans/tool-call-audit.md §6):
// finds the program a shell command actually runs, so failures can be
// grouped by program ("npm 12 / 3 failed"). Deliberately a small, quote-
// aware tokenizer, not a full shell parser — audit grouping only needs the
// first meaningful executable, and an unparseable command simply yields no
// program rather than a guess.

export interface ParsedShellCommand {
  program?: string;
  normalized: string;
}

// Wrappers that run another program; the program after them is the one
// that matters. `timeout` also takes a duration argument.
const WRAPPERS = new Set(["sudo", "env", "time", "nohup", "nice", "exec", "command", "builtin"]);
const WRAPPERS_WITH_ONE_ARG = new Set(["timeout"]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SEGMENT_SEPARATORS = new Set(["&&", "||", ";", "|", "&"]);

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  const flush = () => {
    if (hasToken) {
      tokens.push(current);
    }
    current = "";
    hasToken = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      flush();
      tokens.push(two);
      i += 1;
      continue;
    }
    if (char === ";" || char === "|" || char === "&" || char === "(" || char === ")") {
      flush();
      if (char !== "(" && char !== ")") {
        tokens.push(char);
      }
      continue;
    }
    current += char;
    hasToken = true;
  }
  flush();
  return tokens;
}

function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (SEGMENT_SEPARATORS.has(token)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(token);
    }
  }
  return segments.filter((segment) => segment.length > 0);
}

function programOfSegment(segment: string[]): string | undefined {
  let i = 0;
  while (i < segment.length) {
    const token = segment[i];
    if (ENV_ASSIGNMENT.test(token)) {
      i += 1;
    } else if (WRAPPERS.has(token)) {
      i += 1;
      // `env -i`, `sudo -u user`-style flags are skipped conservatively.
      while (i < segment.length && segment[i].startsWith("-")) {
        i += 1;
      }
    } else if (WRAPPERS_WITH_ONE_ARG.has(token)) {
      i += 2;
    } else {
      break;
    }
  }
  const program = segment[i];
  return program ? program.split("/").pop() || program : undefined;
}

export function parseShellCommand(command: string): ParsedShellCommand {
  const normalized = command.trim().replace(/\s+/g, " ");
  const segments = splitSegments(tokenize(command));
  const programs = segments.map(programOfSegment).filter((p): p is string => p !== undefined);
  // `cd x && npm test` is "an npm run in x": skip leading cd segments unless
  // cd is all there is.
  const program = programs.find((p) => p !== "cd") ?? programs[0];
  return { ...(program ? { program } : {}), normalized };
}
