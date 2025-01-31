import { type Sample, type Step } from "./types.ts";

export class Histogram implements Iterable<Sample> {
  static readonly empty = Histogram.from([]);

  private readonly _data: Map<number, Sample>;

  constructor(samples: readonly Sample[]) {
    this._data = new Map(
      Array.from(samples)
        .sort((a, b) => a.codePoint - b.codePoint)
        .map((sample) => [sample.codePoint, sample]),
    );
  }

  [Symbol.iterator](): IterableIterator<Sample> {
    return this._data.values();
  }

  get complexity(): number {
    return this._data.size;
  }

  has(codePoint: number): boolean {
    return this._data.has(codePoint);
  }

  get(codePoint: number): Sample | null {
    return this._data.get(codePoint) ?? null;
  }

  static from(
    steps: readonly Step[],
    {
      startedAt = null,
    }: {
      readonly startedAt?: number | null;
    } = {},
  ): Histogram {
    const samples = new Map<
      number,
      { hitCount: number; missCount: number; timeToType: number }
    >();
    let last: Step | null =
      startedAt != null
        ? { codePoint: 0, timeStamp: startedAt, typo: false }
        : null;
    for (const step of steps) {
      let sample = samples.get(step.codePoint);
      if (sample == null) {
        samples.set(
          step.codePoint,
          (sample = { hitCount: 0, missCount: 0, timeToType: 0 }),
        );
      }
      sample.hitCount += 1;
      if (step.typo) {
        sample.missCount += 1;
      } else if (last != null) {
        sample.timeToType += step.timeStamp - last.timeStamp;
      }
      last = step;
    }
    return new Histogram(
      [...samples.entries()].map(
        ([codePoint, { hitCount, missCount, timeToType }]) => ({
          codePoint,
          hitCount,
          missCount,
          timeToType: Math.round(timeToType / hitCount),
        }),
      ),
    );
  }
}
