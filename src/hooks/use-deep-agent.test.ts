import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeAgentController, getAgentController } from "./use-deep-agent";
import type { ApprovalRequest } from "@/lib/agent/types";

// The vitest environment is node — stub storage like a browser.
const storage = new Map<string, string>();

function setTerminalApproval(mode: "auto" | "task" | "ask") {
  storage.set("chatui:settings", JSON.stringify({ terminalApproval: mode }));
}

function approvalRequest(command: string): ApprovalRequest {
  return { command, source: "run_command" };
}

/** The private approval gate on an AgentController (arrow-function class field). */
function approvalGate(sessionId: string) {
  return getAgentController(sessionId)["promptForApproval" as never] as unknown as (
    request: ApprovalRequest,
  ) => Promise<{ approved: boolean }>;
}

/** Let queued microtasks (emits, promise resolutions) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const SESSION_IDS = ["approval-parallel", "approval-auto", "approval-task", "approval-stop", "approval-rows"];

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});

afterEach(() => {
  for (const id of SESSION_IDS) disposeAgentController(id);
  vi.unstubAllGlobals();
});

describe("parallel approval cards", () => {
  it("shows a card for every parallel request at once and settles each independently", async () => {
    setTerminalApproval("ask");
    const gate = approvalGate("approval-parallel");
    const ctrl = getAgentController("approval-parallel");
    // ToolNode runs parallel tool calls via Promise.all — all four arrive at
    // once and each must get its own approvable card.
    const p1 = gate(approvalRequest("echo one"));
    const p2 = gate(approvalRequest("echo two"));
    const p3 = gate(approvalRequest("echo three"));
    const p4 = gate(approvalRequest("echo four"));
    await flush();
    expect(ctrl.pendingApprovals.map((p) => p.request.command)).toEqual([
      "echo one",
      "echo two",
      "echo three",
      "echo four",
    ]);
    // Decisions can land in any order.
    ctrl.rejectCommand(ctrl.pendingApprovals[1].id);
    await expect(p2).resolves.toEqual({ approved: false });
    ctrl.approveCommand(ctrl.pendingApprovals[0].id);
    await expect(p1).resolves.toEqual({ approved: true });
    ctrl.rejectCommand(ctrl.pendingApprovals[0].id);
    await expect(p3).resolves.toEqual({ approved: false });
    ctrl.approveCommand(ctrl.pendingApprovals[0].id);
    await expect(p4).resolves.toEqual({ approved: true });
    expect(ctrl.pendingApprovals).toEqual([]);
  });

  it("approves immediately in auto mode", async () => {
    setTerminalApproval("auto");
    const gate = approvalGate("approval-auto");
    const ctrl = getAgentController("approval-auto");
    await expect(gate(approvalRequest("echo hi"))).resolves.toEqual({ approved: true });
    expect(ctrl.pendingApprovals).toEqual([]);
  });

  it("auto-approves later commands in task mode but leaves shown cards independent", async () => {
    setTerminalApproval("task");
    const gate = approvalGate("approval-task");
    const ctrl = getAgentController("approval-task");
    // Two parallel commands arrive before any approval: both get cards.
    const p1 = gate(approvalRequest("echo one"));
    const p2 = gate(approvalRequest("echo two"));
    await flush();
    expect(ctrl.pendingApprovals).toHaveLength(2);
    ctrl.approveCommand(ctrl.pendingApprovals[0].id);
    await expect(p1).resolves.toEqual({ approved: true });
    // The already-shown sibling still needs its own decision...
    ctrl.rejectCommand(ctrl.pendingApprovals[0].id);
    await expect(p2).resolves.toEqual({ approved: false });
    // ...but the rest of the task's commands no longer need a card.
    await expect(gate(approvalRequest("echo three"))).resolves.toEqual({ approved: true });
    expect(ctrl.pendingApprovals).toEqual([]);
  });

  it("denies every outstanding card when the run is stopped", async () => {
    setTerminalApproval("ask");
    const gate = approvalGate("approval-stop");
    const ctrl = getAgentController("approval-stop");
    (ctrl as unknown as { abortRef: AbortController | null }).abortRef = new AbortController();
    const p1 = gate(approvalRequest("echo one"));
    const p2 = gate(approvalRequest("echo two"));
    const p3 = gate(approvalRequest("echo three"));
    await flush();
    expect(ctrl.pendingApprovals).toHaveLength(3);
    ctrl.stop();
    await expect(p1).resolves.toEqual({ approved: false });
    await expect(p2).resolves.toEqual({ approved: false });
    await expect(p3).resolves.toEqual({ approved: false });
    expect(ctrl.pendingApprovals).toEqual([]);
  });

  it("records a separate activity row per approval", async () => {
    setTerminalApproval("ask");
    const gate = approvalGate("approval-rows");
    const ctrl = getAgentController("approval-rows");
    const p1 = gate(approvalRequest("echo one"));
    const p2 = gate(approvalRequest("echo two"));
    await flush();
    ctrl.approveCommand(ctrl.pendingApprovals[0].id);
    ctrl.rejectCommand(ctrl.pendingApprovals[0].id);
    await Promise.all([p1, p2]);
    const rows = ctrl.activities.filter((a) => a.id.startsWith("command-approval-"));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    const labels = rows.map((r) => r.label).sort();
    expect(labels).toEqual(["Approved", "Denied"]);
  });
});
