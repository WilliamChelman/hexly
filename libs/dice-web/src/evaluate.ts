import { Comparator, DiceAst, DiceNode, DiceTermResult, DieRoll, RerollModifier, Rng, RollResult } from './dice';

/** Caps explosion/reroll chains per die so a Roll never runs away (issue #249). */
export const CHAIN_LIMIT = 100;

/** Evaluate a Dice Expression under `rng`. Division floors to a whole number. */
export function evaluate(ast: DiceAst, rng: Rng): RollResult {
  const terms: DiceTermResult[] = [];
  const total = evalNode(ast, rng, terms);
  return { total, terms };
}

function evalNode(node: DiceAst, rng: Rng, terms: DiceTermResult[]): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'negate':
      return -evalNode(node.operand, rng, terms);
    case 'binary': {
      const left = evalNode(node.left, rng, terms);
      const right = evalNode(node.right, rng, terms);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return Math.floor(left / right);
      }
    }
    // falls through — 'binary' is exhaustive above
    case 'dice': {
      const result = rollDice(node, rng);
      terms.push(result);
      return result.subtotal;
    }
  }
}

function rollDice(node: DiceNode, rng: Rng): DiceTermResult {
  const explode = node.modifiers.some((m) => m.kind === 'explode');
  const reroll = node.modifiers.find((m): m is RerollModifier => m.kind === 'reroll');
  const dice: DieRoll[] = [];
  for (let i = 0; i < node.count; i++) {
    dice.push(rollOneDie(node.sides, rng, explode, reroll));
  }
  applyKeepDrop(node, dice);
  const subtotal = dice.reduce((sum, d) => (d.dropped ? sum : sum + d.value), 0);
  return { type: 'dice', count: node.count, sides: node.sides, dice, subtotal };
}

function rollOneDie(sides: number, rng: Rng, explode: boolean, reroll: RerollModifier | undefined): DieRoll {
  const faces: number[] = [];
  let face = rollFace(sides, rng);
  faces.push(face);

  // Reroll applies to the base roll only; explosion rolls are never rerolled.
  if (reroll) {
    let guard = 0;
    while (matches(face, reroll.comparator, reroll.value) && guard < CHAIN_LIMIT) {
      face = rollFace(sides, rng);
      faces.push(face);
      guard++;
    }
  }

  let value = face;
  if (explode) {
    let guard = 0;
    let last = face;
    while (last === sides && guard < CHAIN_LIMIT) {
      last = rollFace(sides, rng);
      faces.push(last);
      value += last;
      guard++;
    }
  }

  return { faces, value, dropped: false };
}

function applyKeepDrop(node: DiceNode, dice: DieRoll[]): void {
  for (const mod of node.modifiers) {
    if (mod.kind !== 'keep' && mod.kind !== 'drop') continue;
    const live = dice.map((d, i) => ({ i, value: d.value })).filter(({ i }) => !dice[i].dropped);
    const byValueAsc = [...live].sort((a, b) => a.value - b.value);
    const n = Math.min(mod.count, byValueAsc.length);
    const fromEnd = mod.end === 'high' ? byValueAsc.slice(byValueAsc.length - n) : byValueAsc.slice(0, n);

    let toDrop: readonly { i: number }[];
    if (mod.kind === 'keep') {
      const kept = new Set(fromEnd.map((x) => x.i));
      toDrop = live.filter((x) => !kept.has(x.i));
    } else {
      toDrop = fromEnd;
    }
    for (const { i } of toDrop) dice[i] = { ...dice[i], dropped: true };
  }
}

function rollFace(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

function matches(face: number, comparator: Comparator, value: number): boolean {
  switch (comparator) {
    case '<':
      return face < value;
    case '<=':
      return face <= value;
    case '>':
      return face > value;
    case '>=':
      return face >= value;
    case '=':
      return face === value;
  }
}
