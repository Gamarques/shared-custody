/**
 * Fake Supabase client for demo mode. It only records what the app asks for (a serializable
 * `DemoRequest`) and hands it to an executor: the server runs it on the in-memory store
 * directly (./server.ts), the browser posts it to /api/demo (./browser.ts), so both sides
 * read and write the same data.
 *
 * Only the parts of supabase-js the app uses are implemented: from().select/insert/update/
 * delete with eq/neq/gt/gte/lt/lte/is/in filters (including filters on embedded tables),
 * order, limit, single, maybeSingle; rpc(); storage upload/remove/createSignedUrl; and the
 * auth calls, which always answer with the fixed demo user.
 */

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "in";
export type Filter = { column: string; op: FilterOp; value: unknown };
export type Order = { column: string; ascending: boolean };
export type Row = Record<string, unknown>;

export type TableRequest = {
  kind: "table";
  table: string;
  action: "select" | "insert" | "update" | "delete";
  /** PostgREST select string: the columns read, or returned by a write followed by select(). */
  columns: string | null;
  values?: Row | Row[];
  filters: Filter[];
  order: Order[];
  limit?: number;
  single?: "single" | "maybe";
  count?: "exact";
  head?: boolean;
};

export type RpcRequest = { kind: "rpc"; fn: string; args: Row };

export type StorageRequest =
  | { kind: "storage"; op: "upload"; bucket: string; path: string; base64: string; contentType: string; upsert: boolean }
  | { kind: "storage"; op: "remove"; bucket: string; paths: string[] }
  | { kind: "storage"; op: "createSignedUrl"; bucket: string; path: string; expiresIn: number };

export type DemoRequest = TableRequest | RpcRequest | StorageRequest;

export type DemoError = { code: string; message: string; details: string | null; hint: string | null };
export type DemoResult = { data: unknown; error: DemoError | null; count?: number | null; status: number };

export type Executor = (request: DemoRequest) => Promise<DemoResult>;

export type DemoUser = { id: string; email: string };

export class DemoQueryBuilder implements PromiseLike<DemoResult> {
  private readonly request: TableRequest;

  constructor(
    private readonly execute: Executor,
    table: string,
  ) {
    this.request = { kind: "table", table, action: "select", columns: null, filters: [], order: [] };
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }): this {
    // After insert/update/delete, select() asks for the written rows back.
    this.request.columns = columns;
    if (options?.count) this.request.count = options.count;
    if (options?.head) this.request.head = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.request.action = "insert";
    this.request.values = values;
    return this;
  }

  update(values: Row): this {
    this.request.action = "update";
    this.request.values = values;
    return this;
  }

  delete(): this {
    this.request.action = "delete";
    return this;
  }

  private filter(column: string, op: FilterOp, value: unknown): this {
    this.request.filters.push({ column, op, value });
    return this;
  }

  eq(column: string, value: unknown) {
    return this.filter(column, "eq", value);
  }
  neq(column: string, value: unknown) {
    return this.filter(column, "neq", value);
  }
  gt(column: string, value: unknown) {
    return this.filter(column, "gt", value);
  }
  gte(column: string, value: unknown) {
    return this.filter(column, "gte", value);
  }
  lt(column: string, value: unknown) {
    return this.filter(column, "lt", value);
  }
  lte(column: string, value: unknown) {
    return this.filter(column, "lte", value);
  }
  is(column: string, value: null | boolean) {
    return this.filter(column, "is", value);
  }
  in(column: string, values: readonly unknown[]) {
    return this.filter(column, "in", [...values]);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.request.order.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.request.limit = count;
    return this;
  }

  single(): this {
    this.request.single = "single";
    return this;
  }

  maybeSingle(): this {
    this.request.single = "maybe";
    return this;
  }

  then<R1 = DemoResult, R2 = never>(
    onfulfilled?: ((value: DemoResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute(structuredClone(this.request)).then(onfulfilled, onrejected);
  }
}

async function toBase64(body: unknown): Promise<string> {
  let bytes: Uint8Array;
  if (body instanceof Uint8Array) bytes = body;
  else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body && typeof (body as Blob).arrayBuffer === "function") bytes = new Uint8Array(await (body as Blob).arrayBuffer());
  else if (typeof body === "string") bytes = new TextEncoder().encode(body);
  else throw new Error("Unsupported upload body");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function createDemoClient(execute: Executor, user: DemoUser) {
  const claims = { sub: user.id, email: user.email, role: "authenticated" };
  return {
    from: (table: string) => new DemoQueryBuilder(execute, table),
    rpc: (fn: string, args: Row = {}) => execute({ kind: "rpc", fn, args }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown, options?: { contentType?: string; upsert?: boolean }) =>
          execute({
            kind: "storage",
            op: "upload",
            bucket,
            path,
            base64: await toBase64(body),
            contentType: options?.contentType ?? (body as Blob | undefined)?.type ?? "application/octet-stream",
            upsert: options?.upsert ?? false,
          }),
        remove: (paths: string[]) => execute({ kind: "storage", op: "remove", bucket, paths }),
        createSignedUrl: async (path: string, expiresIn: number) => {
          const result = await execute({ kind: "storage", op: "createSignedUrl", bucket, path, expiresIn });
          return { data: result.data as { signedUrl: string } | null, error: result.error };
        },
      }),
    },
    // Auth is bypassed: the demo user is always signed in.
    auth: {
      getClaims: async () => ({ data: { claims, header: {}, signature: new Uint8Array() }, error: null }),
      getUser: async () => ({ data: { user: { id: user.id, email: user.email } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOtp: async () => ({ data: { user: null, session: null }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}

export type DemoClient = ReturnType<typeof createDemoClient>;
