import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/icons/Icon";
import { Segmented } from "@/components/ui";
import type { AppProps } from "@/types";

/* ==========================================================================
   Calculator

   Expressions are parsed and evaluated by a small recursive-descent parser —
   no `eval`, no `Function` constructor. Nothing here can execute code.
   ========================================================================== */

type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "function"; value: string }
  | { kind: "constant"; value: number };

const functions: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  sin: (value) => Math.sin((value * Math.PI) / 180),
  cos: (value) => Math.cos((value * Math.PI) / 180),
  tan: (value) => Math.tan((value * Math.PI) / 180),
  ln: Math.log,
  log: Math.log10,
  abs: Math.abs,
  round: Math.round,
};

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let index = 0;
  const source = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");

  while (index < source.length) {
    const char = source[index];

    if (/[0-9.]/.test(char)) {
      let literal = "";
      while (index < source.length && /[0-9.]/.test(source[index])) {
        literal += source[index];
        index += 1;
      }
      if ((literal.match(/\./g) ?? []).length > 1) return `Malformed number: ${literal}`;
      const value = Number(literal);
      if (!Number.isFinite(value)) return `Malformed number: ${literal}`;
      tokens.push({ kind: "number", value });
      continue;
    }

    if (/[a-z]/i.test(char)) {
      let name = "";
      while (index < source.length && /[a-z]/i.test(source[index])) {
        name += source[index];
        index += 1;
      }
      const lower = name.toLowerCase();
      if (lower === "pi") tokens.push({ kind: "constant", value: Math.PI });
      else if (lower === "e") tokens.push({ kind: "constant", value: Math.E });
      else if (functions[lower]) tokens.push({ kind: "function", value: lower });
      else return `Unknown name: ${name}`;
      continue;
    }

    if ("+-*/^%".includes(char)) {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      index += 1;
      continue;
    }

    return `Unexpected character: ${char}`;
  }

  return tokens;
}

/** Recursive descent: expression → term → factor → unary → primary. */
function parse(tokens: Token[]): number | string {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const parseExpression = (): number => {
    let left = parseTerm();
    while (peek()?.kind === "operator" && ["+", "-"].includes((peek() as { value: string }).value)) {
      const operator = (tokens[position] as { value: string }).value;
      position += 1;
      const right = parseTerm();
      left = operator === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parsePower();
    while (peek()?.kind === "operator" && ["*", "/", "%"].includes((peek() as { value: string }).value)) {
      const operator = (tokens[position] as { value: string }).value;
      position += 1;
      const right = parsePower();
      if (operator === "*") left *= right;
      else if (operator === "/") left /= right;
      else left %= right;
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek()?.kind === "operator" && (peek() as { value: string }).value === "^") {
      position += 1;
      return base ** parsePower();
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek()?.kind === "operator" && ["-", "+"].includes((peek() as { value: string }).value)) {
      const operator = (tokens[position] as { value: string }).value;
      position += 1;
      const value = parseUnary();
      return operator === "-" ? -value : value;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.kind === "number") {
      position += 1;
      return token.value;
    }
    if (token.kind === "constant") {
      position += 1;
      return token.value;
    }
    if (token.kind === "function") {
      position += 1;
      const argument = parsePrimary();
      return functions[token.value](argument);
    }
    if (token.kind === "paren" && token.value === "(") {
      position += 1;
      const value = parseExpression();
      const closing = peek();
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        throw new Error("Missing closing parenthesis");
      }
      position += 1;
      return value;
    }
    throw new Error("Unexpected token");
  };

  try {
    if (tokens.length === 0) return "";
    const value = parseExpression();
    if (position < tokens.length) return "Unexpected trailing input";
    if (!Number.isFinite(value)) return "Result is not a finite number";
    return value;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not evaluate";
  }
}

export function evaluate(expression: string): number | string {
  const tokens = tokenize(expression);
  if (typeof tokens === "string") return tokens;
  return parse(tokens);
}

function formatResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

interface HistoryEntry {
  expression: string;
  result: string;
}

export function Calculator({}: AppProps) {
  const [mode, setMode] = useState<"standard" | "scientific">("standard");
  const [expression, setExpression] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const preview = useMemo(() => {
    if (!expression.trim()) return "";
    const result = evaluate(expression);
    return typeof result === "number" ? formatResult(result) : "";
  }, [expression]);

  const commit = useCallback(() => {
    if (!expression.trim()) return;
    const result = evaluate(expression);
    if (typeof result !== "number") {
      setHistory((current) => [{ expression, result: String(result) }, ...current].slice(0, 40));
      return;
    }
    const formatted = formatResult(result);
    setHistory((current) => [{ expression, result: formatted }, ...current].slice(0, 40));
    setExpression(formatted);
  }, [expression]);

  const insert = useCallback((text: string) => {
    setExpression((current) => `${current}${text}`);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") setExpression("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit]);

  const standardKeys = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "%", "+"];
  const scientificKeys = ["sqrt(", "sin(", "cos(", "tan(", "log(", "ln(", "abs(", "pi", "e", "^", "(", ")"];

  return (
    <div className="cr-app cr-calc">
      <div className="cr-app__header">
        <Icon name="calculator" size={16} />
        <span className="cr-app__title">Calculator</span>
        <div style={{ marginLeft: "auto" }}>
          <Segmented
            value={mode}
            label="Mode"
            onChange={setMode}
            options={[
              { value: "standard", label: "Standard" },
              { value: "scientific", label: "Scientific" },
            ]}
          />
        </div>
      </div>

      <div className="cr-calc__display">
        <input
          className="cr-calc__input cr-mono"
          value={expression}
          placeholder="0"
          autoFocus
          spellCheck={false}
          aria-label="Expression"
          onChange={(event) => setExpression(event.target.value)}
        />
        <div className="cr-calc__preview cr-num" aria-live="polite">
          {preview ? `= ${preview}` : ""}
        </div>
      </div>

      <div className="cr-calc__keys">
        {mode === "scientific" && (
          <div className="cr-calc__key-row cr-calc__key-row--fn">
            {scientificKeys.map((key) => (
              <button key={key} type="button" className="cr-calc__key cr-calc__key--fn" onClick={() => insert(key)}>
                {key.replace("(", "")}
              </button>
            ))}
          </div>
        )}
        <div className="cr-calc__key-row">
          <button
            type="button"
            className="cr-calc__key cr-calc__key--wide"
            onClick={() => setExpression((current) => current.slice(0, -1))}
            aria-label="Backspace"
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button type="button" className="cr-calc__key" onClick={() => setExpression("")}>
            C
          </button>
          <button
            type="button"
            className="cr-calc__key"
            onClick={() => setExpression((current) => (current.startsWith("-") ? current.slice(1) : `-${current}`))}
            aria-label="Toggle sign"
          >
            ±
          </button>
        </div>
        <div className="cr-calc__key-grid">
          {standardKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={`cr-calc__key${["/", "*", "-", "+", "%"].includes(key) ? " cr-calc__key--op" : ""}`}
              onClick={() => insert(key)}
            >
              {key}
            </button>
          ))}
        </div>
        <button type="button" className="cr-calc__key cr-calc__key--equals" onClick={commit}>
          =
        </button>
      </div>

      <div className="cr-calc__history">
        <div className="cr-calc__history-title">
          Session history
          {history.length > 0 && (
            <button type="button" className="cr-calc__clear" onClick={() => setHistory([])}>
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="cr-calc__history-empty">
            Results appear here while the calculator stays open. Nothing is written to disk.
          </p>
        ) : (
          history.map((entry, index) => (
            <button
              key={`${entry.expression}-${index}`}
              type="button"
              className="cr-calc__history-row"
              onClick={() => setExpression(entry.expression)}
            >
              <span className="cr-truncate">{entry.expression}</span>
              <span className="cr-calc__history-result cr-num">{entry.result}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
