import { assertNever, type Result } from "./actions";

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type CalcError =
  | { readonly kind: "parse_error"; readonly message: string; readonly position: number }
  | { readonly kind: "division_by_zero" }
  | { readonly kind: "unsupported_result"; readonly message: string };

const MAX_EXPRESSION_LENGTH = 200;

type TokenType = "NUMBER" | "PLUS" | "MINUS" | "STAR" | "SLASH" | "PERCENT" | "CARET" | "LPAREN" | "RPAREN" | "EOF";

interface Token {
  readonly type: TokenType;
  readonly value: number | null;
  readonly position: number;
}

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  "+": "PLUS",
  "-": "MINUS",
  "*": "STAR",
  "/": "SLASH",
  "%": "PERCENT",
  "^": "CARET",
  "(": "LPAREN",
  ")": "RPAREN",
};

function tokenize(expression: string): Result<Token[], CalcError> {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    if (char === " " || char === "\t" || char === "\n") {
      i++;
      continue;
    }

    const singleCharType = SINGLE_CHAR_TOKENS[char];
    if (singleCharType) {
      tokens.push({ type: singleCharType, value: null, position: i });
      i++;
      continue;
    }

    if (char >= "0" && char <= "9") {
      const start = i;
      let sawDot = false;
      while (i < expression.length && ((expression[i] >= "0" && expression[i] <= "9") || (expression[i] === "." && !sawDot))) {
        if (expression[i] === ".") sawDot = true;
        i++;
      }
      const text = expression.slice(start, i);
      tokens.push({ type: "NUMBER", value: Number(text), position: start });
      continue;
    }

    return err({ kind: "parse_error", message: `unexpected character '${char}'`, position: i });
  }

  tokens.push({ type: "EOF", value: null, position: expression.length });
  return ok(tokens);
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.position];
  }

  private advance(): Token {
    const token = this.tokens[this.position];
    this.position++;
    return token;
  }

  parseExpr(): Result<number, CalcError> {
    let leftResult = this.parseTerm();
    if (!leftResult.ok) return leftResult;
    let left = leftResult.value;

    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.advance();
      const rightResult = this.parseTerm();
      if (!rightResult.ok) return rightResult;
      left = op.type === "PLUS" ? left + rightResult.value : left - rightResult.value;
    }

    return ok(left);
  }

  private parseTerm(): Result<number, CalcError> {
    let leftResult = this.parsePower();
    if (!leftResult.ok) return leftResult;
    let left = leftResult.value;

    while (this.peek().type === "STAR" || this.peek().type === "SLASH" || this.peek().type === "PERCENT") {
      const op = this.advance();
      const rightResult = this.parsePower();
      if (!rightResult.ok) return rightResult;
      const right = rightResult.value;

      if (op.type === "STAR") {
        left = left * right;
      } else if (op.type === "SLASH") {
        if (right === 0) return err({ kind: "division_by_zero" });
        left = left / right;
      } else if (op.type === "PERCENT") {
        if (right === 0) return err({ kind: "division_by_zero" });
        left = left % right;
      } else {
        return assertNever(op.type as never, "parseTerm");
      }
    }

    return ok(left);
  }

  private parsePower(): Result<number, CalcError> {
    const baseResult = this.parseUnary();
    if (!baseResult.ok) return baseResult;

    if (this.peek().type === "CARET") {
      this.advance();
      const exponentResult = this.parsePower(); // right-associative
      if (!exponentResult.ok) return exponentResult;
      return ok(Math.pow(baseResult.value, exponentResult.value));
    }

    return baseResult;
  }

  private parseUnary(): Result<number, CalcError> {
    if (this.peek().type === "MINUS") {
      this.advance();
      const result = this.parseUnary();
      if (!result.ok) return result;
      return ok(-result.value);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Result<number, CalcError> {
    const token = this.peek();

    if (token.type === "NUMBER") {
      this.advance();
      return ok(token.value as number);
    }

    if (token.type === "LPAREN") {
      this.advance();
      const result = this.parseExpr();
      if (!result.ok) return result;
      if (this.peek().type !== "RPAREN") {
        return err({ kind: "parse_error", message: "expected ')'", position: this.peek().position });
      }
      this.advance();
      return result;
    }

    return err({ kind: "parse_error", message: `unexpected token`, position: token.position });
  }

  isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  currentPosition(): number {
    return this.peek().position;
  }
}

export function evaluateExpression(expression: string): Result<number, CalcError> {
  if (expression.length === 0) {
    return err({ kind: "parse_error", message: "empty expression", position: 0 });
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return err({ kind: "parse_error", message: `expression exceeds ${MAX_EXPRESSION_LENGTH} characters`, position: MAX_EXPRESSION_LENGTH });
  }

  const tokensResult = tokenize(expression);
  if (!tokensResult.ok) return tokensResult;

  const parser = new Parser(tokensResult.value);
  const result = parser.parseExpr();
  if (!result.ok) return result;

  if (!parser.isAtEnd()) {
    return err({ kind: "parse_error", message: "unexpected trailing input", position: parser.currentPosition() });
  }

  if (!Number.isFinite(result.value)) {
    return err({ kind: "unsupported_result", message: "result is not a finite number" });
  }

  return ok(result.value);
}
