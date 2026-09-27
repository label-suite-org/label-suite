import { sql, type SQL } from "drizzle-orm";

export interface DatabaseRequestContext {
  userId: string;
  orgId?: string;
  localToolTokenId?: string;
}

type ContextTransaction = {
  execute(query: SQL): Promise<unknown>;
};

type SetDatabaseConfig = (
  name: string,
  value: string,
  transactionLocal: true,
) => Promise<void>;

export async function applyDatabaseRequestContext(
  transaction: ContextTransaction,
  context: DatabaseRequestContext,
  setConfig: SetDatabaseConfig = async (name, value, transactionLocal) => {
    await transaction.execute(sql`select set_config(${name}, ${value}, ${transactionLocal})`);
  },
): Promise<void> {
  await setConfig("app.current_user_id", context.userId, true);
  await setConfig("app.current_org_id", context.orgId ?? "", true);
  await setConfig("app.current_local_tool_token_id", context.localToolTokenId ?? "", true);
}
