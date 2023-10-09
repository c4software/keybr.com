import { isWhitespace, toCodePoints } from "@keybr/unicode";
import { normalize, normalizeWhitespace } from "./normalize.ts";
import { type TextInputSettings } from "./settings.ts";
import {
  attrCursor,
  attrGarbage,
  attrHit,
  attrMiss,
  attrNormal,
  type Char,
  Feedback,
  type Step,
} from "./types.ts";

export type StepListener = (step: Step) => void;

const recoverBufferLength = 3;
const garbageBufferLength = 10;

export class TextInput {
  readonly text: string;
  readonly codePoints: readonly number[];
  readonly stopOnError: boolean;
  readonly forgiveErrors: boolean;
  readonly spaceSkipsWords: boolean;
  readonly #onStep: StepListener;
  #steps: Step[] = [];
  #garbage: Step[] = [];
  #typo: boolean = false;

  constructor(
    text: string,
    { stopOnError, forgiveErrors, spaceSkipsWords }: TextInputSettings,
    onStep: StepListener = () => {},
  ) {
    this.text = text; // TODO Normalize?
    this.codePoints = [...toCodePoints(text)];
    this.stopOnError = stopOnError;
    this.forgiveErrors = forgiveErrors;
    this.spaceSkipsWords = spaceSkipsWords;
    this.#onStep = onStep;
    this.reset();
  }

  reset(): void {
    this.#steps = [];
    this.#garbage = [];
    this.#typo = false;
  }

  get completed(): boolean {
    return this.#steps.length === this.codePoints.length;
  }

  step(codePoint: number, timeStamp: number): Feedback {
    if (this.completed) {
      // Cannot enter any more characters if already completed.
      throw new Error();
    }

    codePoint = normalizeWhitespace(codePoint);

    // Handle whitespace at the beginning of text.
    if (
      this.#steps.length === 0 &&
      this.#garbage.length === 0 &&
      !this.#typo &&
      codePoint === 0x0020
    ) {
      return Feedback.Succeeded;
    }

    // Handle the delete key.
    if (codePoint === 0x0008) {
      if (this.#garbage.length > 0) {
        this.#garbage.pop();
        return Feedback.Succeeded;
      } else {
        return Feedback.Failed;
      }
    }

    // Handle the space key.
    if (
      codePoint === 0x0020 &&
      !isWhitespace(this.codePoints[this.#steps.length])
    ) {
      if (
        this.#garbage.length === 0 &&
        (this.#steps.length === 0 ||
          isWhitespace(this.codePoints[this.#steps.length - 1]))
      ) {
        // At the beginning of a word.
        return Feedback.Succeeded;
      }

      if (this.spaceSkipsWords) {
        // Inside a word.
        this.#handleSpace(timeStamp);
        return Feedback.Recovered;
      }
    }

    // Handle correct input.
    if (
      normalize(this.codePoints[this.#steps.length]) === codePoint &&
      (this.forgiveErrors || this.#garbage.length === 0)
    ) {
      const typo = this.#typo;
      this.#addStep({
        codePoint,
        timeStamp,
        typo,
      });
      this.#garbage = [];
      this.#typo = false;
      if (typo) {
        return Feedback.Recovered;
      } else {
        return Feedback.Succeeded;
      }
    }

    // Handle incorrect input.
    this.#typo = true;
    if (!this.stopOnError || this.forgiveErrors) {
      if (this.#garbage.length < garbageBufferLength) {
        this.#garbage.push({
          codePoint,
          timeStamp,
          typo: false,
        });
      }
    }
    if (
      this.forgiveErrors &&
      (this.#handleReplacedCharacter() || this.#handleSkippedCharacter())
    ) {
      return Feedback.Recovered;
    }
    return Feedback.Failed;
  }

  getSteps(): readonly Step[] {
    return this.#steps;
  }

  getChars(): readonly Char[] {
    const chars: Char[] = [];
    for (let i = 0; i < this.codePoints.length; i++) {
      const codePoint = this.codePoints[i];
      if (i < this.#steps.length) {
        // Append characters before cursor.
        const step = this.#steps[i];
        chars.push(toChar(codePoint, step.typo ? attrMiss : attrHit));
      } else if (i === this.#steps.length) {
        if (!this.stopOnError) {
          // Append buffered garbage.
          for (const { codePoint } of this.#garbage) {
            chars.push(toChar(codePoint, attrGarbage));
          }
        }
        // Append character at cursor.
        chars.push(toChar(codePoint, attrCursor));
      } else {
        // Append characters after cursor.
        chars.push(toChar(codePoint, attrNormal));
      }
    }
    return chars;
  }

  #addStep(step: Step): void {
    this.#steps.push(step);
    this.#onStep(step);
  }

  #handleSpace(timeStamp: number): void {
    this.#addStep({
      codePoint: this.codePoints[this.#steps.length],
      timeStamp,
      typo: true,
    });
    // Skip the remaining non-space characters inside the word.
    while (
      this.#steps.length < this.codePoints.length &&
      !isWhitespace(this.codePoints[this.#steps.length])
    ) {
      this.#addStep({
        codePoint: this.codePoints[this.#steps.length],
        timeStamp,
        typo: true,
      });
    }
    // Skip the space character to position at the beginning of next word.
    if (
      this.#steps.length < this.codePoints.length &&
      isWhitespace(this.codePoints[this.#steps.length])
    ) {
      this.#addStep({
        codePoint: this.codePoints[this.#steps.length],
        timeStamp,
        typo: false,
      });
    }
    this.#garbage = [];
    this.#typo = false;
  }

  #handleReplacedCharacter(): boolean {
    // text:    abcd
    // garbage: xbcd
    // offset:  0

    // Check if the buffer size is right.
    if (
      this.#garbage.length < recoverBufferLength + 1 ||
      this.#steps.length + recoverBufferLength + 1 > this.codePoints.length
    ) {
      return false;
    }

    // Check if can recover.
    for (let i = 0; i < recoverBufferLength; i++) {
      const codePoint = this.codePoints[this.#steps.length + i + 1];
      if (codePoint !== this.#garbage[i + 1].codePoint) {
        return false;
      }
    }

    // Append a step with an error.
    this.#addStep({
      codePoint: this.codePoints[this.#steps.length],
      timeStamp: this.#garbage[0].timeStamp,
      typo: true,
    });

    // Append successful steps.
    for (let i = 1; i < this.#garbage.length; i++) {
      const { codePoint, timeStamp } = this.#garbage[i];
      this.#addStep({
        codePoint,
        timeStamp,
        typo: false,
      });
    }

    this.#garbage = [];
    this.#typo = false;
    return true;
  }

  #handleSkippedCharacter(): boolean {
    // text:    abcd
    // garbage: bcd
    // offset:  0

    // Check if the buffer size is right.
    if (
      this.#garbage.length < recoverBufferLength ||
      this.#steps.length + recoverBufferLength + 1 > this.codePoints.length
    ) {
      return false;
    }

    // Check if can recover.
    for (let i = 0; i < recoverBufferLength; i++) {
      const codePoint = this.codePoints[this.#steps.length + i + 1];
      if (codePoint !== this.#garbage[i].codePoint) {
        return false;
      }
    }

    // Append a step with an error.
    this.#addStep({
      codePoint: this.codePoints[this.#steps.length],
      timeStamp: this.#garbage[0].timeStamp,
      typo: true,
    });

    // Append successful steps.
    for (let i = 0; i < this.#garbage.length; i++) {
      const { codePoint, timeStamp } = this.#garbage[i];
      this.#addStep({
        codePoint,
        timeStamp,
        typo: false,
      });
    }

    this.#garbage = [];
    this.#typo = false;
    return true;
  }
}

const charCache = new Map<number, Char>();

function toChar(codePoint: number, attrs: number): Char {
  const key = (codePoint & 0x00ff_ffff) | ((attrs & 0x0000_00ff) << 24);
  let char = charCache.get(key);
  if (char == null) {
    charCache.set(key, (char = { codePoint, attrs }));
  }
  return char;
}
