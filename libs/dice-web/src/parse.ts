import { BinaryNode, Comparator, DiceAst, DiceErrorCode, DiceModifier, ParseResult } from './dice';

/**
 * Parse a Dice Expression into an AST, or a typed error — never throws (issue
 * #249). Recursive descent with standard precedence: `+ -` bind looser than
 * `* /`, parentheses override, and per-term modifiers (`kh`/`kl`/`dh`/`dl`, `!`,
 * `r`) attach to the `NdM` term they follow. Whitespace around operators is
 * tolerated; the digits of an `NdM` term and its modifiers are not split.
 */
export function parse(expression: string): ParseResult {
  const parser = new Parser(expression);
  try {
    const ast = parser.parseRoot();
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof ParseFailure) {
      return { ok: false, error: { code: e.code, message: e.message, position: e.position } };
    }
    throw e;
  }
}

/** Internal control-flow signal; `parse` converts it into a typed `DiceError`. */
class ParseFailure {
  constructor(
    readonly code: DiceErrorCode,
    readonly message: string,
    readonly position: number,
  ) {}
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseRoot(): DiceAst {
    this.skipWhitespace();
    if (this.pos >= this.src.length) {
      throw new ParseFailure('empty', 'Expression is empty.', 0);
    }
    const ast = this.parseAdditive();
    this.skipWhitespace();
    if (this.pos < this.src.length) {
      throw new ParseFailure('trailing-input', `Unexpected "${this.src[this.pos]}".`, this.pos);
    }
    return ast;
  }

  private parseAdditive(): DiceAst {
    return this.parseBinaryLevel(['+', '-'], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): DiceAst {
    return this.parseBinaryLevel(['*', '/'], () => this.parseUnary());
  }

  /** One left-associative precedence tier: `next` operands joined by `ops`. */
  private parseBinaryLevel(ops: readonly BinaryNode['op'][], next: () => DiceAst): DiceAst {
    let left = next();
    for (;;) {
      this.skipWhitespace();
      const op = this.peek();
      if (op === undefined || !ops.includes(op as BinaryNode['op'])) break;
      this.pos++;
      left = { type: 'binary', op: op as BinaryNode['op'], left, right: next() };
    }
    return left;
  }

  private parseUnary(): DiceAst {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '-') {
      this.pos++;
      return { type: 'negate', operand: this.parseUnary() };
    }
    if (ch === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): DiceAst {
    this.skipWhitespace();
    if (this.peek() === '(') {
      this.pos++;
      const inner = this.parseAdditive();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw new ParseFailure('unbalanced-parens', 'Missing closing parenthesis.', this.pos);
      }
      this.pos++;
      return inner;
    }
    return this.parseNumberOrDice();
  }

  private parseNumberOrDice(): DiceAst {
    const count = this.isDigit(this.peek()) ? this.readInteger() : undefined;
    // A die needs a `d` followed by its sides; `d20` (implicit count 1) is allowed.
    if (this.peek() === 'd' && this.isDigit(this.peekAt(1))) {
      this.pos++;
      const sides = this.readInteger();
      if (sides <= 0) {
        throw new ParseFailure('invalid-dice', 'A die needs at least one side.', this.pos);
      }
      const diceCount = count ?? 1;
      if (diceCount <= 0) {
        throw new ParseFailure('invalid-dice', 'A dice term needs at least one die.', 0);
      }
      return { type: 'dice', count: diceCount, sides, modifiers: this.parseModifiers() };
    }
    if (count === undefined) {
      const found = this.peek();
      throw new ParseFailure('syntax', found ? `Unexpected "${found}".` : 'Unexpected end of input.', this.pos);
    }
    return { type: 'number', value: count };
  }

  private parseModifiers(): DiceModifier[] {
    const mods: DiceModifier[] = [];
    for (;;) {
      const ch = this.peek();
      if (ch === 'k' || ch === 'd') {
        this.pos++;
        const end = this.peek();
        if (end !== 'h' && end !== 'l') {
          throw new ParseFailure('syntax', `Expected "h" or "l" after "${ch}".`, this.pos);
        }
        this.pos++;
        const count = this.isDigit(this.peek()) ? this.readInteger() : 1;
        mods.push({ kind: ch === 'k' ? 'keep' : 'drop', end: end === 'h' ? 'high' : 'low', count });
      } else if (ch === '!') {
        this.pos++;
        mods.push({ kind: 'explode' });
      } else if (ch === 'r') {
        this.pos++;
        const comparator = this.readComparator();
        const value = this.readInteger();
        mods.push({ kind: 'reroll', comparator, value });
      } else {
        break;
      }
    }
    return mods;
  }

  private readComparator(): Comparator {
    const ch = this.peek();
    if (ch === '<') {
      this.pos++;
      if (this.peek() === '=') {
        this.pos++;
        return '<=';
      }
      return '<';
    }
    if (ch === '>') {
      this.pos++;
      if (this.peek() === '=') {
        this.pos++;
        return '>=';
      }
      return '>';
    }
    if (ch === '=') {
      this.pos++;
    }
    // A bare `r2` rerolls on equality, matching common dice notation.
    return '=';
  }

  private readInteger(): number {
    const start = this.pos;
    while (this.isDigit(this.peek())) this.pos++;
    if (this.pos === start) {
      throw new ParseFailure('syntax', 'Expected a number.', this.pos);
    }
    return Number(this.src.slice(start, this.pos));
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private peekAt(offset: number): string | undefined {
    return this.src[this.pos + offset];
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }
}
