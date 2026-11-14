import * as vscode from 'vscode';

export interface TreeNodeSpec {
  label: string;
  /** Stable id: keeps expansion state across re-renders. Must be unique within the view. */
  id?: string;
  description?: string;
  /** Plain text only — server data must never reach a Markdown tooltip unescaped. */
  tooltip?: string;
  icon?: string | vscode.ThemeIcon;
  contextValue?: string;
  /** A command id (invoked with this node as the only argument) or a full command. */
  command?: string | vscode.Command;
  /** Web link opened by `gitPilot.openItem` (must already be sanitized with `safeWebUrl`). */
  url?: string;
  /** Free-form payload for item commands (e.g. a label name). */
  value?: string;
  children?: TreeNode[];
  /** Initial state for nodes with children (default: expanded). */
  expanded?: boolean;
}

/**
 * Immutable node of a sidebar section. Item commands receive the node itself, so a handler
 * can check `arg instanceof TreeNode` and trust only data that Git Pilot put there.
 */
export class TreeNode {
  readonly item: vscode.TreeItem;
  readonly children: readonly TreeNode[];
  readonly url: string | undefined;
  readonly value: string | undefined;

  constructor(spec: TreeNodeSpec) {
    this.children = spec.children ?? [];
    this.url = spec.url;
    this.value = spec.value;

    const state = this.children.length
      ? spec.expanded === false
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(spec.label, state);
    item.id = spec.id;
    item.description = spec.description;
    item.tooltip = spec.tooltip;
    item.contextValue = spec.contextValue;
    item.iconPath = typeof spec.icon === 'string' ? new vscode.ThemeIcon(spec.icon) : spec.icon;
    if (typeof spec.command === 'string') {
      item.command = { command: spec.command, title: spec.label, arguments: [this] };
    } else {
      item.command = spec.command;
    }
    this.item = item;
  }
}

/**
 * One block of the Git Pilot sidebar: a TreeView over a re-renderable list of root nodes.
 * Each module that contributes a section owns one `SectionView` for its view id.
 */
export class SectionView implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly view: vscode.TreeView<TreeNode>;
  private roots: readonly TreeNode[] = [];

  constructor(
    readonly viewId: string,
    options: { showCollapseAll?: boolean } = {},
  ) {
    this.view = vscode.window.createTreeView(viewId, { treeDataProvider: this, showCollapseAll: options.showCollapseAll });
  }

  get visible(): boolean {
    return this.view.visible;
  }

  /** Replaces the content. `message` is shown above the tree (e.g. why it is empty). */
  render(roots: readonly TreeNode[], message?: string): void {
    this.roots = roots;
    this.view.message = message;
    this.changed.fire();
  }

  set description(value: string | undefined) {
    this.view.description = value;
  }

  /** Shows the thin progress bar at the top of the section while `task` runs. */
  withProgress<T>(task: () => Promise<T>): Promise<T> {
    return Promise.resolve(vscode.window.withProgress({ location: { viewId: this.viewId } }, task));
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node.item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return [...(node ? node.children : this.roots)];
  }

  dispose(): void {
    this.view.dispose();
    this.changed.dispose();
  }
}
