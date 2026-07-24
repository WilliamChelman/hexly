import { InjectionToken } from '@angular/core';
import { Result } from 'neverthrow';

// Pure dice engine contracts (issue #249). Interpretation beyond the total is
// the caller's, not the engine's (CONTEXT.md — Dice).

/** A float in `[0, 1)` — the shape of `Math.random`. */
export type Rng = () => number;

/** Overridable to make a Roll deterministic; `evaluate` takes an `Rng` directly, so the engine is testable without DI. */
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

export interface KeepDropModifier {
  readonly kind: 'keep' | 'drop';
  readonly end: 'high' | 'low';
  readonly count: number;
}

export interface ExplodeModifier {
  readonly kind: 'explode';
}

export type Comparator = '<' | '<=' | '>' | '>=' | '=';

export interface RerollModifier {
  readonly kind: 'reroll';
  readonly comparator: Comparator;
  readonly value: number;
}

// --- Parse result -------------------------------------------------------------

export type DiceErrorCode = 'empty' | 'syntax' | 'invalid-dice' | 'unbalanced-parens' | 'trailing-input';

export interface DiceError {
  readonly code: DiceErrorCode;
  readonly message: string;
  /** 0-based source index, when known. */
  readonly position?: number;
}

/** Parsing never throws — failures come back as a typed {@link DiceError}. */
export type ParseResult = Result<DiceAst, DiceError>;

// --- Roll Result --------------------------------------------------------------

export interface DieRoll {
  /** Every raw face rolled, discarded rerolls and explosions included — so faces may exceed `value`. */
  readonly faces: readonly number[];
  /** Accepted face plus explosions — not the sum of `faces`, which retains discarded rerolls. */
  readonly value: number;
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
  /** Dice terms only, in source order — literals and arithmetic carry no faces. */
  readonly terms: readonly DiceTermResult[];
}
