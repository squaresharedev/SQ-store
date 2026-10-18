/**
 * How BOTH test replicas create their cluster (tests/db/global-setup.ts and
 * the e2e stack). UTF8 because production is: left to initdb, Windows picks
 * the machine's code page (WIN1252), which cannot store Czech, Arabic or
 * emoji, so no test could ever hold the text real sellers and buyers type.
 */
export const REPLICA_INITDB_FLAGS = ["--encoding=UTF8"];
