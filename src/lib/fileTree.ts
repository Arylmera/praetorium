import type { VaultFile } from "./types";

export interface TreeFile { kind: "file"; name: string; rel: string }
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;            // forward-slash path, "" for root
  folders: TreeFolder[];
  files: TreeFile[];
  count: number;           // total descendant files
}

const norm = (s: string) => s.replace(/\\/g, "/");

export function buildTree(files: VaultFile[]): TreeFolder {
  const root: TreeFolder = { kind: "folder", name: "", path: "", folders: [], files: [], count: 0 };
  for (const file of files) {
    const parts = norm(file.rel).split("/").filter(Boolean);
    const fileName = parts.pop()!;
    let node = root;
    for (const seg of parts) {
      let next = node.folders.find((x) => x.name === seg);
      if (!next) {
        next = { kind: "folder", name: seg, path: node.path ? `${node.path}/${seg}` : seg, folders: [], files: [], count: 0 };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push({ kind: "file", name: fileName, rel: norm(file.rel) });
  }
  const finish = (n: TreeFolder): number => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.name.localeCompare(b.name));
    let c = n.files.length;
    for (const sub of n.folders) c += finish(sub);
    n.count = c;
    return c;
  };
  finish(root);
  return root;
}

export interface Row {
  kind: "folder" | "file";
  id: string;              // folder.path or file.rel — unique
  name: string;
  depth: number;
  count?: number;          // folders only
}

export function flattenVisible(root: TreeFolder, open: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (node: TreeFolder, depth: number) => {
    for (const folder of node.folders) {
      rows.push({ kind: "folder", id: folder.path, name: folder.name, depth, count: folder.count });
      if (open.has(folder.path)) walk(folder, depth + 1);
    }
    for (const file of node.files) {
      rows.push({ kind: "file", id: file.rel, name: file.name, depth });
    }
  };
  walk(root, 0);
  return rows;
}
