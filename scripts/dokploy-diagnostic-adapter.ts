import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import {
  classifySisenseDiagnosticLog,
  type ProbeOutcome,
} from "./sisense-diagnostic-log-probe";
import type {
  ControllerAdapter,
  DeploymentRecord,
  ManualRunOutcome,
  ScheduleRecord,
} from "./sisense-diagnostic-controller";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const WebSocket = require("ws") as WebSocketConstructor;
const MAX_LOG_BYTES = 262_144;
const LOG_TIMEOUT_MILLISECONDS = 10_000;

type WebSocketLike = {
  close(): void;
  on(event: "message", listener: (chunk: Uint8Array) => void): void;
  on(event: "error" | "close", listener: () => void): void;
};

type WebSocketConstructor = new (
  address: URL,
  options: { headers: Record<string, string> },
) => WebSocketLike;

export type DokployConnection = {
  url: string;
  token: string;
};

type DeploymentLogRead =
  | { kind: "log"; value: string }
  | { kind: "unavailable"; code: Extract<ProbeOutcome, { kind: "retrieval_unavailable" }>["code"] };

export interface DokployTransport {
  json(args: string[], code: string, timeout?: number): Promise<unknown>;
  post(endpoint: string, body: unknown, code: string): Promise<unknown>;
  command(args: string[], code: string, timeout?: number): Promise<void>;
  readDeploymentLog(logPath: string): Promise<DeploymentLogRead>;
}

export function createDokployDiagnosticAdapter(input: {
  composeId: string;
  connection: DokployConnection;
  dokployBinary?: string;
}): ControllerAdapter {
  const dokployBinary = input.dokployBinary ?? "dokploy";
  return createDokployDiagnosticAdapterFromTransport({
    composeId: input.composeId,
    transport: {
      json: (args, code, timeout) => dokployJson(dokployBinary, args, code, timeout),
      post: (endpoint, body, code) => dokployPost(input.connection, endpoint, body, code),
      async command(args, code, timeout) {
        await dokployCommand(dokployBinary, args, code, timeout);
      },
      readDeploymentLog: (logPath) => readDeploymentLog(input.connection, logPath),
    },
  });
}

export function createDokployDiagnosticAdapterFromTransport(input: {
  composeId: string;
  transport: DokployTransport;
}): ControllerAdapter {
  return {
    async listSchedules() {
      const value = await input.transport.json(
        ["schedule", "list", "--id", input.composeId, "--scheduleType", "compose", "--json"],
        "schedule_inventory_failed",
      );
      if (!Array.isArray(value)) throw operatorError("schedule_inventory_invalid");
      return value.map(parseSchedule);
    },
    async createDisabledSchedule(request) {
      if (request.enabled !== false) throw operatorError("schedule_disabled_required");
      const value = await input.transport.post("schedule.create", {
        name: request.name,
        description: request.description,
        cronExpression: request.cronExpression,
        appName: request.appName,
        serviceName: request.serviceName,
        shellType: request.shellType,
        scheduleType: request.scheduleType,
        command: request.command,
        composeId: request.composeId,
        timezone: request.timezone,
        enabled: false,
      }, "schedule_create_failed");
      return parseSchedule(value);
    },
    async readSchedule(scheduleId) {
      const value = await input.transport.json(
        ["schedule", "one", "--scheduleId", scheduleId, "--json"],
        "schedule_readback_failed",
      );
      return value === null ? null : parseSchedule(value);
    },
    async listDeployments(scheduleId) {
      const value = await input.transport.json(
        ["deployment", "all-by-type", "--id", scheduleId, "--type", "schedule", "--json"],
        "deployment_history_failed",
      );
      if (!Array.isArray(value)) throw operatorError("deployment_history_invalid");
      return value.map(parseDeployment);
    },
    async runManual(scheduleId): Promise<ManualRunOutcome> {
      try {
        const value = await input.transport.json(
          ["schedule", "run-manually", "--scheduleId", scheduleId, "--json"],
          "manual_cli_failed",
          20 * 60 * 1000,
        );
        if (!isRecord(value)) return { kind: "malformed_response" };
        return {
          kind: "response",
          ...(typeof value.status === "string" ? { status: value.status } : {}),
          ...(typeof value.deploymentId === "string" ? { deploymentId: value.deploymentId } : {}),
          ...(typeof value.logPath === "string" ? { logPath: value.logPath } : {}),
          ...(typeof value.serverId === "string" ? { serverId: value.serverId } : {}),
        };
      } catch (error) {
        if (error instanceof OperatorAdapterError && error.code === "manual_cli_timeout") return { kind: "timeout" };
        return { kind: "nonzero", code: "manual_cli_nonzero" };
      }
    },
    async probeDeploymentLog(deployment, mode): Promise<ProbeOutcome> {
      const read = await input.transport.readDeploymentLog(deployment.logPath);
      return read.kind === "log"
        ? classifySisenseDiagnosticLog(read.value, mode)
        : { kind: "retrieval_unavailable", code: read.code };
    },
    async deleteSchedule(scheduleId) {
      await input.transport.command(
        ["schedule", "delete", "--scheduleId", scheduleId, "--json"],
        "schedule_delete_failed",
      );
    },
    async pause(milliseconds) {
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    },
  };
}

async function dokployJson(
  binary: string,
  args: string[],
  code: string,
  timeout = 120_000,
): Promise<unknown> {
  const output = await dokployCommand(binary, args, code, timeout);
  try {
    return JSON.parse(output);
  } catch {
    throw operatorError(`${code}_json_invalid`);
  }
}

async function dokployCommand(binary: string, args: string[], code: string, timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await execFile(binary, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error: unknown) {
    if (isTimeout(error)) throw operatorError(code === "manual_cli_failed" ? "manual_cli_timeout" : code);
    throw operatorError(code);
  }
}

async function dokployPost(connection: DokployConnection, endpoint: string, body: unknown, code: string): Promise<unknown> {
  try {
    const response = await fetch(new URL(`/api/trpc/${endpoint}`, connection.url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": connection.token },
      body: JSON.stringify({ json: body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("request failed");
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) throw new Error("malformed response");
    const result = isRecord(payload.result) && isRecord(payload.result.data) ? payload.result.data.json : payload;
    if (!result) throw new Error("missing result");
    return result;
  } catch {
    throw operatorError(code);
  }
}

function parseSchedule(value: unknown): ScheduleRecord {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.scheduleId) ||
    !isNonEmptyString(value.name) ||
    typeof value.enabled !== "boolean" ||
    !isNonEmptyString(value.scheduleType) ||
    !isNonEmptyString(value.composeId) ||
    !isNonEmptyString(value.appName) ||
    !isNonEmptyString(value.serviceName) ||
    !isNonEmptyString(value.shellType) ||
    !(isNonEmptyString(value.timezone) || value.timezone === null) ||
    !isNonEmptyString(value.cronExpression) ||
    typeof value.command !== "string"
  ) {
    throw operatorError("schedule_record_invalid");
  }
  return {
    scheduleId: value.scheduleId,
    name: value.name,
    enabled: value.enabled,
    scheduleType: value.scheduleType,
    composeId: value.composeId,
    appName: value.appName,
    serviceName: value.serviceName,
    shellType: value.shellType,
    timezone: value.timezone,
    command: value.command,
    cronExpression: value.cronExpression,
    ...(typeof value.description === "string" || value.description === null ? { description: value.description } : {}),
  };
}

function parseDeployment(value: unknown): DeploymentRecord {
  if (!isRecord(value) || !isNonEmptyString(value.deploymentId) || !isNonEmptyString(value.status)) {
    throw operatorError("deployment_record_invalid");
  }
  return {
    deploymentId: value.deploymentId,
    status: value.status,
    ...(typeof value.logPath === "string" ? { logPath: value.logPath } : {}),
    ...(typeof value.serverId === "string" ? { serverId: value.serverId } : {}),
  };
}

function readDeploymentLog(connection: DokployConnection, logPath: string): Promise<DeploymentLogRead> {
  if (!isApprovedLogPath(logPath)) return Promise.resolve({ kind: "unavailable", code: "deployment_log_invalid" });

  return new Promise((resolve) => {
    const endpoint = new URL(connection.url);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.pathname = "/listen-deployment";
    endpoint.search = "";
    endpoint.searchParams.set("logPath", logPath);

    let complete = false;
    let buffer = "";
    const finish = (outcome: DeploymentLogRead, socket: WebSocketLike) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      socket.close();
      resolve(outcome);
    };
    const socket = new WebSocket(endpoint, { headers: { "x-api-key": connection.token } });
    const timeout = setTimeout(() => finish({ kind: "unavailable", code: "deployment_log_timeout" }, socket), LOG_TIMEOUT_MILLISECONDS);
    socket.on("message", (chunk) => {
      if (complete) return;
      const value = chunk.toString();
      if (Buffer.byteLength(buffer) + Buffer.byteLength(value) > MAX_LOG_BYTES) {
        finish({ kind: "unavailable", code: "deployment_log_too_large" }, socket);
        return;
      }
      buffer += value;
      if (buffer.includes("Command executed successfully") || buffer.includes("Command failed")) {
        finish({ kind: "log", value: buffer }, socket);
      }
    });
    socket.on("error", () => finish({ kind: "unavailable", code: "deployment_log_connection" }, socket));
    socket.on("close", () => {
      if (!complete) finish({ kind: "unavailable", code: "deployment_log_connection" }, socket);
    });
  });
}

function isApprovedLogPath(value: string): boolean {
  return value.startsWith("/etc/dokploy/schedules/") && value === normalizePosixPath(value) && !value.includes("\\") && !value.includes("\0");
}

function normalizePosixPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return "";
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

class OperatorAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function operatorError(code: string): OperatorAdapterError {
  return new OperatorAdapterError(code);
}

function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "killed" in error && error.killed === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
