export type PaneId = number;

export type SplitDir = "row" | "col";

export type PaneNode =
  | { kind: "leaf"; id: PaneId; cwd?: string; originTitle?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
    };

export function isLeaf(
  n: PaneNode,
): n is Extract<PaneNode, { kind: "leaf" }> {
  return n.kind === "leaf";
}

export function leafIds(n: PaneNode): PaneId[] {
  if (isLeaf(n)) return [n.id];
  return n.children.flatMap(leafIds);
}

export function findLeafCwd(n: PaneNode, id: PaneId): string | undefined {
  if (isLeaf(n)) return n.id === id ? n.cwd : undefined;
  for (const c of n.children) {
    const found = findLeafCwd(c, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function setLeafCwd(
  n: PaneNode,
  id: PaneId,
  cwd: string,
): PaneNode {
  if (isLeaf(n)) {
    if (n.id !== id || n.cwd === cwd) return n;
    return { ...n, cwd };
  }
  let changed = false;
  const next = n.children.map((c) => {
    const u = setLeafCwd(c, id, cwd);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...n, children: next } : n;
}

/**
 * Insert a new leaf next to `targetId` in direction `dir`.
 *
 * If the target's enclosing split already runs in `dir`, the new leaf is
 * appended as a sibling there (avoids nested same-direction splits — keeps
 * the tree shallow and the resize handles aligned).
 */
export function splitLeaf(
  tree: PaneNode,
  targetId: PaneId,
  newSplitId: PaneId,
  newLeafId: PaneId,
  dir: SplitDir,
  newCwd?: string,
): PaneNode {
  if (tree.kind === "split" && tree.dir === dir) {
    const idx = tree.children.findIndex(
      (c) => c.kind === "leaf" && c.id === targetId,
    );
    if (idx >= 0) {
      const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
      return {
        ...tree,
        children: [
          ...tree.children.slice(0, idx + 1),
          newLeaf,
          ...tree.children.slice(idx + 1),
        ],
      };
    }
  }
  if (isLeaf(tree)) {
    if (tree.id !== targetId) return tree;
    const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
    return {
      kind: "split",
      id: newSplitId,
      dir,
      children: [tree, newLeaf],
    };
  }
  return {
    ...tree,
    children: tree.children.map((c) =>
      splitLeaf(c, targetId, newSplitId, newLeafId, dir, newCwd),
    ),
  };
}

/**
 * Graft an existing subtree next to `targetId` in direction `dir`.
 *
 * Same placement rules as `splitLeaf`, but inserts `node` (a whole moved
 * subtree, leaf ids preserved) instead of a fresh leaf. `before` puts the
 * grafted subtree first (for left/top drops).
 */
export function graftNode(
  tree: PaneNode,
  targetId: PaneId,
  dir: SplitDir,
  node: PaneNode,
  before: boolean,
  newSplitId: PaneId,
): PaneNode {
  if (tree.kind === "split" && tree.dir === dir) {
    const idx = tree.children.findIndex(
      (c) => c.kind === "leaf" && c.id === targetId,
    );
    if (idx >= 0) {
      const at = before ? idx : idx + 1;
      return {
        ...tree,
        children: [
          ...tree.children.slice(0, at),
          node,
          ...tree.children.slice(at),
        ],
      };
    }
  }
  if (isLeaf(tree)) {
    if (tree.id !== targetId) return tree;
    return {
      kind: "split",
      id: newSplitId,
      dir,
      children: before ? [node, tree] : [tree, node],
    };
  }
  return {
    ...tree,
    children: tree.children.map((c) =>
      graftNode(c, targetId, dir, node, before, newSplitId),
    ),
  };
}

/**
 * Remove a leaf and collapse single-child splits left in its wake. Returns
 * `null` when the entire subtree is gone.
 */
export function removeLeaf(
  tree: PaneNode,
  targetId: PaneId,
): PaneNode | null {
  if (isLeaf(tree)) return tree.id === targetId ? null : tree;
  const newChildren: PaneNode[] = [];
  for (const c of tree.children) {
    const r = removeLeaf(c, targetId);
    if (r !== null) newChildren.push(r);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...tree, children: newChildren };
}

/**
 * Extract a leaf from the tree and return it as a standalone single-leaf tree.
 * The remaining tree is returned alongside (or `null` if the leaf was the only node).
 * Unlike `removeLeaf`, the extracted leaf node is preserved for reuse in a new tab.
 */
export function extractLeaf(
  tree: PaneNode,
  leafId: PaneId,
): { tree: PaneNode | null; extracted: PaneNode } | null {
  if (!hasLeaf(tree, leafId)) return null;
  function findNode(n: PaneNode): PaneNode | null {
    if (isLeaf(n)) return n.id === leafId ? n : null;
    for (const c of n.children) {
      const found = findNode(c);
      if (found) return found;
    }
    return null;
  }
  const extracted = findNode(tree);
  if (!extracted) return null;
  return { tree: removeLeaf(tree, leafId), extracted };
}

export function nextLeafId(
  tree: PaneNode,
  currentId: PaneId,
  delta: 1 | -1,
): PaneId {
  const ids = leafIds(tree);
  if (ids.length === 0) return currentId;
  const idx = ids.indexOf(currentId);
  if (idx < 0) return ids[0];
  return ids[(idx + delta + ids.length) % ids.length];
}

// Closest neighbor of `leafId` within its enclosing split — prefer the
// next sibling, fall back to the previous. Used to pick the new focus
// when a pane closes (so focus stays in the same neighborhood instead of
// snapping to the first pane in the tree).
export function siblingLeafOf(
  tree: PaneNode,
  leafId: PaneId,
): PaneId | null {
  if (isLeaf(tree)) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i];
    if (isLeaf(c) && c.id === leafId) {
      const sibling = tree.children[i + 1] ?? tree.children[i - 1];
      if (!sibling) return null;
      return leafIds(sibling)[0] ?? null;
    }
  }
  for (const c of tree.children) {
    if (!isLeaf(c)) {
      const r = siblingLeafOf(c, leafId);
      if (r !== null) return r;
    }
  }
  return null;
}

export function hasLeaf(tree: PaneNode, id: PaneId): boolean {
  return leafIds(tree).includes(id);
}

/**
 * Stamp every leaf missing one with the display name of the tab it is being
 * grafted out of. Detaching ("Return to tab") restores this name instead of
 * the workspace container's title. Existing stamps survive re-grafts so a
 * pane always remembers its original tab.
 */
export function stampOriginTitle(tree: PaneNode, title: string): PaneNode {
  if (isLeaf(tree)) {
    if (tree.originTitle) return tree;
    return { ...tree, originTitle: title };
  }
  return {
    ...tree,
    children: tree.children.map((c) => stampOriginTitle(c, title)),
  };
}

/** The shared origin stamp when EVERY leaf carries the same one, else null.
 *  Unstamped remainders keep their tab identity (plain detach path). */
export function soleOriginTitle(tree: PaneNode): string | null {
  const found: { origin: string | undefined }[] = [];
  const walk = (n: PaneNode): void => {
    if (isLeaf(n)) {
      found.push({ origin: n.originTitle });
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(tree);
  if (found.length === 0) return null;
  const first = found[0].origin;
  if (first === undefined) return null;
  return found.every((f) => f.origin === first) ? first : null;
}
