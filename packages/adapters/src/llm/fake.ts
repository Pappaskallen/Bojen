import type { ReplyClassifier } from "@bojen/core";

type Answer = Awaited<ReturnType<ReplyClassifier["classify"]>>;
type Call = Parameters<ReplyClassifier["classify"]>[0];

export interface FakeClassifier extends ReplyClassifier {
  /** Every reply it was asked about, in order. */
  readonly calls: Call[];
  /** The answer for a reply, matched on the exact text. */
  answer(reply: string, answer: Answer): void;
}

/**
 * Answers from a table instead of a model, for tests. A reply not in the table is unclear.
 * Never calls anything outside the process.
 */
export function createFakeClassifier(): FakeClassifier {
  const answers = new Map<string, Answer>();
  const calls: Call[] = [];
  return {
    calls,
    answer(reply, answer) {
      answers.set(reply, answer);
    },
    classify(input) {
      calls.push(input);
      return Promise.resolve(answers.get(input.reply) ?? { intent: "unclear", confidence: 0 });
    },
  };
}
