export type ParseStatus =
  | "success"
  | "no-active-editor"
  | "not-python"
  | "missing-marker"
  | "no-graph"
  | "parse-error";

export interface GraphNode {
  id: string;
  label: string;
  kind: "start" | "end" | "node";
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ParsedGraph {
  id: string;
  title: string;
  builderName: string;
  compiledName?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

export interface ParseResult {
  status: ParseStatus;
  graphs: ParsedGraph[];
  warnings: string[];
  message: string;
}

export interface ViewState {
  fileName?: string;
  status: ParseStatus;
  message: string;
  warnings: string[];
  graphs: Array<{
    id: string;
    title: string;
    mermaid: string;
    warnings: string[];
  }>;
  selectedGraphId?: string;
  updatedAt?: string;
}
