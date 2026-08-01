/**
 * One page of a server-side list. Shared by every paginated read (orders,
 * products) so the toolbars, page controls, and tests all speak one shape.
 *
 * `total` is the count of rows matching the CURRENT filters, not the table
 * size, so "N results · page X of Y" is derivable without a second query.
 */
export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};
