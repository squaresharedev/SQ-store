// The few Workers runtime types this Worker uses, declared here so the repo's
// own typecheck (which covers every .ts file, with DOM types) needs no
// Workers type package. The socket module is declared in sockets.d.ts.

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
