"use strict";

// Language-agnostic token counter. Approximates tokens so identifiers like
// "foobar" count as 1 token. Strings and operator sequences are treated as
// single tokens. Common comments are stripped first.

function stripComments(source) {
  if (!source) return "";
  // Remove block comments like /* ... */
  let s = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // line comments (avoid http:// by requiring start or non-: before)
  s = s.replace(/(^|[^:])\/\/.*$/gm, function (_m, p1) { return p1 || ""; });
  // Remove # line comments (common in shell/Python)
  s = s.replace(/(^|\s)#.*$/gm, function (_m, p1) { return p1 || ""; });
  return s;
}

function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

function isIdentifierStart(ch) {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

function isIdentifierPart(ch) {
  return isIdentifierStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

const multiCharOps = [
  "===", "!==", ">>>=", ">>>", "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "<=", ">=", "==", "!=", "&&", "||", "++", "--", "<<", ">>", "**", "->", "::"
].sort(function (a, b) { return b.length - a.length; });

function countCodeTokens(source) {
  if (typeof source !== "string" || source.length === 0) return 0;
  const code = stripComments(source);
  let i = 0;
  let count = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];

    // Skip whitespace
    if (isWhitespace(ch)) { i++; continue; }

    // Strings: "...", '...', `...`
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        const c = code[i];
        if (c === "\\") { i += 2; continue; }
        i++;
        if (c === quote) break;
      }
      count++;
      continue;
    }

    // Identifier
    if (isIdentifierStart(ch)) {
      i++;
      while (i < n && isIdentifierPart(code[i])) i++;
      count++;
      continue;
    }

    // Number
    if (isDigit(ch)) {
      i++;
      // Simple integer/float scanner
      let hasDot = false;
      while (i < n) {
        const c = code[i];
        if (c === "." && !hasDot) { hasDot = true; i++; continue; }
        if (!isDigit(c)) break;
        i++;
      }
      count++;
      continue;
    }

    // Multi-char operators
    let matched = false;
    for (let k = 0; k < multiCharOps.length; k++) {
      const op = multiCharOps[k];
      if (i + op.length <= n && code.slice(i, i + op.length) === op) {
        i += op.length;
        count++;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Single-character operator / punctuator
    // Count any non-whitespace, non-alphanumeric character as one token
    i++;
    count++;
  }

  return count;
}

module.exports = { countCodeTokens };
