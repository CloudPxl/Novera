/**
 * Syntax highlighting for fenced code blocks, with no dependency and no markup.
 *
 * It returns a list of `{ type, text }` tokens whose texts, joined, are exactly the input —
 * the one property that matters, and the one the tests check — and the page renders each
 * token as a `<span className=…>` around a text node. Nothing here produces HTML, so the
 * renderer stays "parsed, never markup", and the colours are classes in a CSS module, so the
 * nonce-based CSP never needs an inline style.
 *
 * Deliberately small: a tokenizer for the languages the guides use, not a parser. When a
 * language is unknown the whole block is one plain token, which is correct, just not coloured.
 */

export type TokenType = "plain" | "comment" | "string" | "number" | "keyword" | "key" | "variable";
export interface Token { type: TokenType; text: string }

type Rule = [TokenType, RegExp];

const DOUBLE = String.raw`"(?:\\.|[^"\\\n])*"`;
const SINGLE = String.raw`'(?:\\.|[^'\\\n])*'`;
const NUMBER = String.raw`\b\d+(?:\.\d+)?\b`;
const words = (list: string) => new RegExp(String.raw`\b(?:${list})\b`);

const JS: Rule[] = [
  ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
  ["string", new RegExp(String.raw`${DOUBLE}|${SINGLE}|` + "`(?:\\\\[\\s\\S]|[^`\\\\])*`")],
  ["number", new RegExp(NUMBER)],
  ["keyword", words("import|export|from|const|let|var|function|async|await|return|if|else|for|while|new|type|interface|as|of|in|throw|try|catch|true|false|null|undefined|default")],
];

const PY: Rule[] = [
  ["comment", /#[^\n]*/],
  ["string", new RegExp(String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|[fbr]?${DOUBLE}|[fbr]?${SINGLE}`)],
  ["number", new RegExp(NUMBER)],
  ["keyword", words("import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|is|with|async|await|try|except|raise|lambda|None|True|False|pass|yield")],
];

const SH: Rule[] = [
  ["comment", /(?<![^\s])#[^\n]*/],
  ["string", new RegExp(`${DOUBLE}|${SINGLE}`)],
  ["variable", /\$\{\{[\s\S]*?\}\}|\$\{[^}\n]*\}|\$[A-Za-z_]\w*/],
  ["number", new RegExp(NUMBER)],
  ["keyword", words("if|then|else|fi|for|do|done|while|case|esac|in|exit|echo|export|set|curl|jq|sleep|break|seq|test")],
];

const YAML: Rule[] = [
  ["comment", /(?<![^\s])#[^\n]*/],
  ["variable", /\$\{\{[\s\S]*?\}\}/],
  ["key", /[A-Za-z_][\w.-]*(?=:(?:\s|$))/],
  ["string", new RegExp(`${DOUBLE}|${SINGLE}`)],
  ["number", new RegExp(NUMBER)],
  ["keyword", words("true|false|null")],
];

const JSON_RULES: Rule[] = [
  ["key", new RegExp(String.raw`${DOUBLE}(?=\s*:)`)],
  ["string", new RegExp(DOUBLE)],
  ["number", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
  ["keyword", words("true|false|null")],
];

const LANGUAGES: Record<string, Rule[]> = {
  js: JS, javascript: JS, jsx: JS, ts: JS, typescript: JS, tsx: JS,
  py: PY, python: PY,
  sh: SH, bash: SH, shell: SH, zsh: SH,
  yaml: YAML, yml: YAML,
  json: JSON_RULES,
};

/** The label shown above a block: what the author wrote, or null for an unlabelled fence. */
export function languageLabel(lang: string | null): string | null {
  return lang ? lang.toLowerCase() : null;
}

export function highlight(text: string, lang: string | null): Token[] {
  const rules = lang ? LANGUAGES[lang.toLowerCase()] : undefined;
  if (!rules || text.length > 20_000) return [{ type: "plain", text }];

  const sticky = rules.map(([type, re]) => [type, new RegExp(re.source, "y")] as const);
  const tokens: Token[] = [];
  let plain = "";
  const flush = () => {
    if (plain) tokens.push({ type: "plain", text: plain });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    let hit: { type: TokenType; text: string } | null = null;
    // A word is never entered halfway: `\b` rules would otherwise match inside `a1b`.
    const prev = i > 0 ? text[i - 1] : "";
    if (!/[\w$]/.test(prev) || !/[\w$]/.test(text[i])) {
      for (const [type, re] of sticky) {
        re.lastIndex = i;
        const m = re.exec(text);
        if (m && m[0].length > 0) { hit = { type, text: m[0] }; break; }
      }
    }
    if (hit) {
      flush();
      tokens.push(hit);
      i += hit.text.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  flush();
  return tokens;
}
