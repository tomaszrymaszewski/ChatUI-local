import type { Message } from "@/types";

export interface MessageNode {
  message: Message;
  children: MessageNode[];
}

export function buildMessageTree(messages: Message[]): {
  roots: MessageNode[];
  nodeMap: Map<string, MessageNode>;
} {
  const nodeMap = new Map<string, MessageNode>();
  const roots: MessageNode[] = [];

  for (const msg of messages) {
    nodeMap.set(msg.id, { message: msg, children: [] });
  }

  for (const msg of messages) {
    const node = nodeMap.get(msg.id)!;
    if (msg.parent_id && nodeMap.has(msg.parent_id)) {
      nodeMap.get(msg.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return { roots, nodeMap };
}

export function getActivePath(
  roots: MessageNode[],
  nodeMap: Map<string, MessageNode>,
  selectedChildMap: Map<string | null, string>,
): MessageNode[] {
  const path: MessageNode[] = [];

  const rootId = selectedChildMap.get(null) ?? roots[roots.length - 1]?.message.id;
  let current = nodeMap.get(rootId ?? "");

  while (current) {
    path.push(current);
    const childId = selectedChildMap.get(current.message.id);
    if (childId && nodeMap.has(childId)) {
      current = nodeMap.get(childId)!;
    } else {
      const lastChild = current.children[current.children.length - 1];
      current = lastChild ?? null;
    }
  }

  return path;
}

export function getSiblings(
  nodeMap: Map<string, MessageNode>,
  message: Message,
  roots?: MessageNode[],
): { siblings: MessageNode[]; currentIndex: number } {
  let siblings: MessageNode[];

  if (message.parent_id && nodeMap.has(message.parent_id)) {
    siblings = nodeMap.get(message.parent_id)!.children;
  } else if (roots) {
    siblings = roots;
  } else {
    const { roots: builtRoots } = buildMessageTree(
      Array.from(nodeMap.values()).map((n) => n.message)
    );
    siblings = builtRoots;
  }

  const currentIndex = siblings.findIndex((s) => s.message.id === message.id);
  return { siblings, currentIndex };
}
