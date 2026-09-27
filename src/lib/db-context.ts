import { AsyncLocalStorage } from "node:async_hooks";

type TransactionCallback<TDatabase extends object, TResult> = (transaction: TDatabase) => Promise<TResult>;

type TransactionalDatabase<TDatabase extends object> = TDatabase & {
  transaction<TResult>(callback: TransactionCallback<TDatabase, TResult>, ...options: unknown[]): Promise<TResult>;
};

type DatabaseContextStore<TDatabase extends object, TContext> = {
  database: TransactionalDatabase<TDatabase>;
  context: TContext;
  transactionOptions?: unknown;
};

export function createRequestScopedDatabase<
  TDatabase extends object,
  TContext,
>(
  rootDatabase: TransactionalDatabase<TDatabase>,
  applyContext: (transaction: TDatabase, context: TContext) => Promise<void>,
): {
  database: TransactionalDatabase<TDatabase>;
  run<TResult>(context: TContext, operation: () => Promise<TResult>, transactionOptions?: unknown): Promise<TResult>;
} {
  const storage = new AsyncLocalStorage<DatabaseContextStore<TDatabase, TContext>>();

  const database = new Proxy(rootDatabase, {
    get(target, property) {
      const source = storage.getStore()?.database ?? target;
      const value = Reflect.get(source, property, source);

      if (property === "transaction" && typeof value === "function") {
        return async <TResult>(
          callback: TransactionCallback<TDatabase, TResult>,
          ...options: unknown[]
        ): Promise<TResult> => {
          const active = storage.getStore();
          if (active && options.length > 0) {
            if (!sameTransactionOptions(active.transactionOptions, options[0])) {
              throw new Error("Nested database transaction options must match the request transaction");
            }
            return value.call(
              source,
              (transaction: TransactionalDatabase<TDatabase>) => storage.run(
                { ...active, database: transaction },
                () => callback(transaction),
              ),
            );
          }
          return value.call(
            source,
            (transaction: TransactionalDatabase<TDatabase>) => active
              ? storage.run(
                { ...active, database: transaction },
                () => callback(transaction),
              )
              : callback(transaction),
            ...options,
          );
        };
      }

      return typeof value === "function" ? value.bind(source) : value;
    },
  });

  async function run<TResult>(context: TContext, operation: () => Promise<TResult>, transactionOptions?: unknown): Promise<TResult> {
    const parent = storage.getStore();
    if (parent && transactionOptions !== undefined && !sameTransactionOptions(parent.transactionOptions, transactionOptions)) {
      throw new Error("Nested database context options must match the request transaction");
    }
    const source = parent?.database ?? rootDatabase;
    const execute = async (transaction: TDatabase) => {
      await applyContext(transaction, context);
      const result = await storage.run(
        {
          database: transaction as TransactionalDatabase<TDatabase>,
          context,
          transactionOptions: parent?.transactionOptions ?? transactionOptions,
        },
        operation,
      );
      if (parent) await applyContext(transaction, parent.context);
      return result;
    };
    return transactionOptions !== undefined && !parent
      ? source.transaction(execute, transactionOptions)
      : source.transaction(execute);
  }

  return { database, run };
}

function sameTransactionOptions(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return left === right;
  const leftOptions = left as Record<string, unknown>;
  const rightOptions = right as Record<string, unknown>;
  return leftOptions.isolationLevel === rightOptions.isolationLevel
    && leftOptions.accessMode === rightOptions.accessMode
    && leftOptions.deferrable === rightOptions.deferrable;
}
