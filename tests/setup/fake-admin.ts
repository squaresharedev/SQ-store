/**
 * AN IN-MEMORY STAND-IN FOR THE SERVICE-ROLE CLIENT, for tests of the code that
 * reads through it (the buyer pages' gates, the discount readers, the quote).
 *
 * Unlike a canned answer per table, it APPLIES the filters a read asks for
 * (eq, in, lt, or(...), order, limit) to rows the test put in, the way
 * PostgREST would. So a test can seed a store, ask the real loaders for a
 * price, and find out whether they asked the right question: a reader that
 * forgot to filter by owner gets the other store's rows back and fails.
 *
 * It also fails on purpose. `fault` is consulted before every read and can
 * make it answer with an error or throw, and `maxRows` caps what one read
 * returns (PostgREST's own ceiling), with the exact count still reported, so
 * "what happens when the database blips or answers short" is a test like any
 * other.
 */

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;
/** What a read should do instead of answering: fail softly, or throw. */
export type Fault = "error" | "throw" | null;

/** A recorded filter: the table, the operator and column, and the value. */
export type RecordedFilter = [table: string, filter: string, value: unknown];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;

/** Order two column values: instants by the moment they name (PostgREST
 *  prints "+00:00" and microseconds, a caller sends "Z"), the rest plainly. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string" && ISO_INSTANT.test(a) && ISO_INSTANT.test(b)) {
    return Date.parse(a) - Date.parse(b);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

const OPERATORS: Record<string, (value: unknown, wanted: unknown) => boolean> = {
  eq: (value, wanted) => value === wanted,
  neq: (value, wanted) => value !== wanted,
  lt: (value, wanted) => value !== null && value !== undefined && compare(value, wanted) < 0,
  lte: (value, wanted) => value !== null && value !== undefined && compare(value, wanted) <= 0,
  gt: (value, wanted) => value !== null && value !== undefined && compare(value, wanted) > 0,
  gte: (value, wanted) => value !== null && value !== undefined && compare(value, wanted) >= 0,
  is: (value, wanted) => (wanted === null ? value === null || value === undefined : value === wanted),
};

/** One `or(...)` term, "column.op.value", as PostgREST spells it. */
function orTerm(term: string): Predicate {
  const [column, op, ...rest] = term.split(".");
  const raw = rest.join(".");
  const wanted = raw === "null" ? null : raw.replace(/^"|"$/g, "");
  const test = OPERATORS[op];
  if (!test) throw new Error(`fake admin: unsupported or() operator in "${term}"`);
  return (row) => test(row[column], wanted);
}

export function createFakeAdmin(tables: Record<string, Row[]> = {}) {
  const state = {
    tables,
    /** The most rows one read returns, whatever limit it asked for. */
    maxRows: 1000,
    /** Consulted before every read. */
    fault: (() => null) as (table: string) => Fault,
    /** Every table read, in order. */
    reads: [] as string[],
    filters: [] as RecordedFilter[],
  };

  function from(table: string) {
    const predicates: Predicate[] = [];
    const sorts: { column: string; ascending: boolean }[] = [];
    let limit: number | null = null;
    let wantsCount = false;
    let head = false;

    const note = (filter: string, value: unknown) => state.filters.push([table, filter, value]);

    function run(): { data: Row[] | null; error: { message: string } | null; count: number | null } {
      state.reads.push(table);
      const fault = state.fault(table);
      if (fault === "throw") throw new Error(`fake admin: ${table} unreachable`);
      if (fault === "error") return { data: null, error: { message: `fake admin: ${table} read failed` }, count: null };

      const matched = (state.tables[table] ?? []).filter((row) => predicates.every((test) => test(row)));
      const sorted = [...matched].sort((a, b) => {
        for (const { column, ascending } of sorts) {
          const order = compare(a[column], b[column]);
          if (order !== 0) return ascending ? order : -order;
        }
        return 0;
      });
      const rows = sorted.slice(0, Math.min(limit ?? Number.POSITIVE_INFINITY, state.maxRows));
      return {
        // A copy of each row: a reader that changed one would otherwise change the store.
        data: head ? null : rows.map((row) => structuredClone(row)),
        error: null,
        count: wantsCount ? matched.length : null,
      };
    }

    const filter = (op: string) => (column: string, wanted: unknown) => {
      note(`${op}:${column}`, wanted);
      predicates.push((row) => OPERATORS[op](row[column], wanted));
      return chain;
    };

    const chain = {
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        wantsCount = options?.count === "exact";
        head = options?.head === true;
        return chain;
      },
      eq: filter("eq"),
      neq: filter("neq"),
      lt: filter("lt"),
      lte: filter("lte"),
      gt: filter("gt"),
      gte: filter("gte"),
      is: filter("is"),
      in(column: string, wanted: readonly unknown[]) {
        note(`in:${column}`, wanted);
        predicates.push((row) => wanted.includes(row[column]));
        return chain;
      },
      or(expression: string) {
        note("or", expression);
        const terms = expression.split(",").map(orTerm);
        predicates.push((row) => terms.some((test) => test(row)));
        return chain;
      },
      order(column: string, options?: { ascending?: boolean }) {
        sorts.push({ column, ascending: options?.ascending !== false });
        return chain;
      },
      limit(count: number) {
        limit = count;
        return chain;
      },
      async maybeSingle() {
        const answer = run();
        if (answer.error) return { data: null, error: answer.error };
        const rows = answer.data ?? [];
        if (rows.length > 1) return { data: null, error: { message: "fake admin: more than one row" } };
        return { data: rows[0] ?? null, error: null };
      },
      // Awaited directly: a list read, or a head count.
      then<T>(resolve: (value: ReturnType<typeof run>) => T, reject?: (reason: unknown) => T) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
        }
      },
    };
    return chain;
  }

  return { admin: { from } as never, state };
}

/** A small seeded generator (mulberry32), so a test that draws thousands of
 *  random stores draws the same ones every run and a failure can be replayed. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A whole number from `min` to `max`, both included. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
  };
}
