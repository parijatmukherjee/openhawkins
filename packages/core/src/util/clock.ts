export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export interface FixedClock extends Clock {
  advance(ms: number): void;
}

export function fixedClock(start: number): FixedClock {
  let now = start;
  const clock = (() => now) as FixedClock;
  clock.advance = (ms: number) => {
    now += ms;
  };
  return clock;
}
