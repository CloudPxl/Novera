/**
 * How firm a verdict is, in one line.
 *
 * Every verdict is put to two models, so "graded by X" alone would overstate a case
 * where only one model could be reached and understate one where three were consulted.
 */
export function gradingNote(model: string, agreement: string | null): string {
  switch (agreement) {
    case "agreed":
      return `graded by ${model}, confirmed by a second model`;
    case "majority":
      return `graded by ${model} after two models disagreed and a third settled it`;
    case "unconfirmed":
      return `graded by ${model} alone — no second model was reachable`;
    case "unresolved":
      return "no verdict: the models disagreed and the tie could not be broken";
    default:
      return `graded by ${model}`;
  }
}
