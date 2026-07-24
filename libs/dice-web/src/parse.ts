import { err, ok, Result } from 'neverthrow';

import { BinaryNode, Comparator, DiceAst, DiceError, DiceModifier, ParseResult } from './dice';

type ParseStep<T> = Result<T, DiceError>;

/**
 * Parse a Dice Expression (issue #249). Every step returns a neverthrow
 * `Result`, so a failure propagates as a value rather than an exception.
 */
export function parse(expression: string): ParseResult {
  return new Parser(expression).parseRoot();
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseRoot(): ParseStep<DiceAst> {
    this.skipWhitespace();
    if (this.pos >= this.src.length) {
      return err({ code: 'empty', message: 'Expression is empty.', position: 0 });
    }
    return this.parseAdditive().andThen((ast) => {
      this.skipWhitespace();
      if (this.pos < this.src.length) {
        return err<DiceAst, DiceError>({
          code: 'trailing-input',
          message: `Unexpected "${this.src[this.pos]}".`,
          position: this.pos,
        });
      }
      return ok(ast);
    });
  }

  private parseAdditive(): ParseStep<DiceAst> {
    return this.parseBinaryLevel(['+', '-'], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): ParseStep<DiceAst> {
    return this.parseBinaryLevel(['*', '/'], () => this.parseUnary());
  }

  private parseBinaryLevel(ops: readonly BinaryNode['op'][], next: () => ParseStep<DiceAst>): ParseStep<DiceAst> {
    const first = next();
    if (first.isErr()) return first;
    let left = first.value;
    for (;;) {
      this.skipWhitespace();
      const op = this.peek();
      if (op === undefined || !ops.includes(op as BinaryNode['op'])) break;
      this.pos++;
      const right = next();
      if (right.isErr()) return right;
      left = { type: 'binary', op: op as BinaryNode['op'], left, right: right.value };
    }
    return ok(left);
  }

  private parseUnary(): ParseStep<DiceAst> {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '-') {
      this.pos++;
      return this.parseUnary().map((operand) => ({ type: 'negate', operand }));
    }
    if (ch === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ParseStep<DiceAst> {
    this.skipWhitespace();
    if (this.peek() === '(') {
      this.pos++;
      return this.parseAdditive().andThen((inner) => {
        this.skipWhitespace();
        if (this.peek() !== ')') {
          return err<DiceAst, DiceError>({
            code: 'unbalanced-parens',
            message: 'Missing closing parenthesis.',
            position: this.pos,
          });
        }
        this.pos++;
        return ok(inner);
      });
    }
    return this.parseNumberOrDice();
  }

  private parseNumberOrDice(): ParseStep<DiceAst> {
    const start = this.pos;
    const count = this.readInteger();
    // `d20` — no leading count — is an implicit single die.
    if (this.peek() === 'd' && this.isDigit(this.peekAt(1))) {
      this.pos++;
      const sides = this.readInteger();
      if (sides === undefined || sides <= 0) {
        return err({ code: 'invalid-dice', message: 'A die needs at least one side.', position: this.pos });
      }
      const diceCount = count ?? 1;
      if (diceCount <= 0) {
        return err({ code: 'invalid-dice', message: 'A dice term needs at least one die.', position: start });
      }
      return this.parseModifiers().map((modifiers) => ({ type: 'dice', count: diceCount, sides, modifiers }));
    }
    if (count === undefined) {
      const found = this.peek();
      return err({
        code: 'syntax',
        message: found ? `Unexpected "${found}".` : 'Unexpected end of input.',
        position: this.pos,
      });
    }
    return ok({ type: 'number', value: count });
  }

  private parseModifiers(): ParseStep<DiceModifier[]> {
    const mods: DiceModifier[] = [];
    for (;;) {
      const ch = this.peek();
      if (ch === 'k' || ch === 'd') {
        this.pos++;
        const end = this.peek();
        if (end !== 'h' && end !== 'l') {
          return err({ code: 'syntax', message: `Expected "h" or "l" after "${ch}".`, position: this.pos });
        }
        this.pos++;
        const count = this.readInteger() ?? 1;
        mods.push({ kind: ch === 'k' ? 'keep' : 'drop', end: end === 'h' ? 'high' : 'low', count });
      } else if (ch === '!') {
        this.pos++;
        mods.push({ kind: 'explode' });
      } else if (ch === 'r') {
        this.pos++;
        const comparator = this.readComparator();
        const value = this.readInteger();
        if (value === undefined) {
          return err({ code: 'syntax', message: 'Expected a number after "r".', position: this.pos });
        }
        mods.push({ kind: 'reroll', comparator, value });
      } else {
        break;
      }
    }
    return ok(mods);
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
    // A bare `r2` rerolls on equality.
    return '=';
  }

  /** `undefined` when no digits follow the cursor. */
  private readInteger(): number | undefined {
    const start = this.pos;
    while (this.isDigit(this.peek())) this.pos++;
    if (this.pos === start) return undefined;
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
