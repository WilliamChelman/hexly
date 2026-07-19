import { InjectionToken } from '@angular/core';
import { Result } from 'neverthrow';

/**
 * The pure dice engine's contracts (issue #249): the parsed Dice Expression AST,
 * the Roll Result shape, and the RNG seam. The engine turns any supported Dice
 * Expression into a Roll Result under a caller-supplied RNG; interpretation
 * beyond the total (e.g. Draw Steel tier bands) belongs to the caller, not here
 * (CONTEXT.md — Dice: Roll, Dice Expression, Roll Result).
 */

/** A random source returning a float in `[0, 1)` — the shape of `Math.random`. */
export type Rng = () => number;

/**
 * The RNG every Roll draws from. Defaults to `Math.random`; callers and tests
 * override it to make a Roll deterministic. `evaluate` also takes an `Rng`
 * directly so the engine is testable without Angular DI.
 */
export const DICE_RNG = new InjectionToken<Rng>('DICE_RNG', {
  providedIn: 'root',
  factory: () => Math.random,
});

// --- Parsed Dice Expression (AST) ---------------------------------------------

export type DiceAst = NumberNode | DiceNode | BinaryNode | NegateNode;

export interface NumberNode {
  readonly type: 'number';
  readonly value: number;
}

/** An `NdM` term with its per-term modifiers (keep/drop, explode, reroll). */
export interface DiceNode {
  readonly type: 'dice';
  readonly count: number;
  readonly sides: number;
  readonly modifiers: readonly DiceModifier[];
}

export interface BinaryNode {
  readonly type: 'binary';
  readonly op: '+' | '-' | '*' | '/';
  readonly left: DiceAst;
  readonly right: DiceAst;
}

export interface NegateNode {
  readonly type: 'negate';
  readonly operand: DiceAst;
}

export type DiceModifier = KeepDropModifier | ExplodeModifier | RerollModifier;

/** `kh`/`kl`/`dh`/`dl` — keep or drop `count` dice from the high or low end. */
export interface KeepDropModifier {
  readonly kind: 'keep' | 'drop';
  readonly end: 'high' | 'low';
  readonly count: number;
}

/** `!` — a die showing its max face rolls again, bounded by a depth guard. */
export interface ExplodeModifier {
  readonly kind: 'explode';
}

export type Comparator = '<' | '<=' | '>' | '>=' | '=';

/** `r<N` etc. — reroll a die while it matches, bounded by a depth guard. */
export interface RerollModifier {
  readonly kind: 'reroll';
  readonly comparator: Comparator;
  readonly value: number;
}

// --- Parse result -------------------------------------------------------------

export type DiceErrorCode = 'empty' | 'syntax' | 'invalid-dice' | 'unbalanced-parens' | 'trailing-input';

/** Invalid input yields one of these, surfaced to the user — never a throw. */
export interface DiceError {
  readonly code: DiceErrorCode;
  readonly message: string;
  /** 0-based index into the source where parsing failed, when known. */
  readonly position?: number;
}

/** `ok` carries the parsed AST; `err` carries a typed {@link DiceError} — parsing never throws. */
export type ParseResult = Result<DiceAst, DiceError>;

// --- Roll Result --------------------------------------------------------------

export interface DieRoll {
  /**
   * Every raw face this die produced, in order — discarded reroll faces and
   * explosion faces included, so the Roll Result stays fully inspectable.
   */
  readonly faces: readonly number[];
  /** The die's net contribution: its accepted face plus any explosion faces. */
  readonly value: number;
  /** True when keep/drop excluded this die from its term's subtotal. */
  readonly dropped: boolean;
}

export interface DiceTermResult {
  readonly type: 'dice';
  readonly count: number;
  readonly sides: number;
  readonly dice: readonly DieRoll[];
  readonly subtotal: number;
}

export interface RollResult {
  readonly total: number;
  /**
   * Every dice term evaluated, in left-to-right source order. Number literals
   * and arithmetic carry no faces, so only dice terms appear here.
   */
  readonly terms: readonly DiceTermResult[];
}
