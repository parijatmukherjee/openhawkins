export type IdFactory = () => string;

export function createIdFactory(prefix: string): IdFactory {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
