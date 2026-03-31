/**
 * Shared field path-checker — imported by both client (CurrentField.tsx) and server.
 * Ported from the original FieldFactory.js.
 */

export type Cell = { x: number; y: number };

/**
 * Searches `field` (2D grid of letters, any case) for a connected chain of
 * adjacent cells that spells `word` (case-insensitive).
 * Returns the chain if found, null otherwise.
 */
export function fieldContains(field: string[][], word: string): Cell[] | null {
  const lower = word.toLowerCase();
  const size = field.length;

  function cloneField(f: (string | null)[][]): (string | null)[][] {
    return f.map((row) => [...row]);
  }

  function recurse(
    f: (string | null)[][],
    pos: number,
    x: number,
    y: number,
    chain: Cell[],
  ): Cell[] | null {
    if (f[y][x]?.toLowerCase() !== lower[pos]) return null;
    const next = [...chain, { x, y }];
    if (pos === lower.length - 1) return next;
    const cloned = cloneField(f);
    cloned[y][x] = null;
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        if (
          nx >= 0 && ny >= 0 && nx < size && ny < size &&
          (nx !== x || ny !== y)
        ) {
          const result = recurse(cloned, pos + 1, nx, ny, next);
          if (result) return result;
        }
      }
    }
    return null;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const result = recurse(field as (string | null)[][], 0, x, y, []);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Converts a flat uppercase field string (e.g. "ABCDEFGHIJKLMNOP") to a 2D grid.
 * Used by the server to convert the stored string before calling fieldContains.
 */
export function fieldToGrid(field: string, size: number): string[][] {
  const grid: string[][] = [];
  for (let y = 0; y < size; y++) {
    grid.push([]);
    for (let x = 0; x < size; x++) {
      grid[y].push(field[y * size + x]);
    }
  }
  return grid;
}
