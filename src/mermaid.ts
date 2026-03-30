import { ParsedGraph } from "./types";

function escapeLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}

function sanitizeMermaidId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `n_${sanitized}`;
}

function mermaidNodeLine(nodeId: string, label: string, kind: ParsedGraph["nodes"][number]["kind"]): string {
  if (kind === "start") {
    return `  ${nodeId}([${escapeLabel(label)}])`;
  }
  if (kind === "end") {
    return `  ${nodeId}([${escapeLabel(label)}])`;
  }
  return `  ${nodeId}["${escapeLabel(label)}"]`;
}

export function graphToMermaid(graph: ParsedGraph): string {
  const lines = ["flowchart TD"];
  const startTargets = new Set(
    graph.edges.filter((edge) => edge.from === "__start__").map((edge) => edge.to),
  );
  const conditionalSources = new Set(
    graph.edges.filter((edge) => Boolean(edge.label)).map((edge) => edge.from),
  );

  for (const node of graph.nodes) {
    const mermaidId = sanitizeMermaidId(node.id);
    const label =
      node.kind === "start"
        ? "__start__"
        : node.kind === "end"
          ? "__end__"
          : node.label;
    lines.push(mermaidNodeLine(mermaidId, label, node.kind));
  }
  for (const edge of graph.edges) {
    const edgeLabel = edge.label ? `|${escapeLabel(edge.label)}|` : "";
    const connector = edge.conditional ? "-.->" : "-->";
    lines.push(
      `  ${sanitizeMermaidId(edge.from)} ${connector}${edgeLabel} ${sanitizeMermaidId(edge.to)}`,
    );
  }
  for (const node of graph.nodes) {
    const mermaidId = sanitizeMermaidId(node.id);
    if (node.kind === "start") {
      lines.push(`  class ${mermaidId} statevizStart;`);
      continue;
    }
    if (node.kind === "end") {
      lines.push(`  class ${mermaidId} statevizEnd;`);
      continue;
    }
    if (startTargets.has(node.id) || conditionalSources.has(node.id)) {
      lines.push(`  class ${mermaidId} statevizFocus;`);
      continue;
    }
    lines.push(`  class ${mermaidId} statevizNode;`);
  }
  lines.push(
    "  classDef statevizStart fill:#2f2d3d,stroke:#bb68ff,color:#e1baff,stroke-width:2px;",
  );
  lines.push(
    "  classDef statevizFocus fill:#2e243a,stroke:#bb68ff,color:#f0c8ff,stroke-width:2px;",
  );
  lines.push(
    "  classDef statevizNode fill:#24303f,stroke:#5aa4e7,color:#d6ebff,stroke-width:2px;",
  );
  lines.push(
    "  classDef statevizEnd fill:#39363a,stroke:#d6ab58,color:#f7e4bf,stroke-width:2px;",
  );
  return lines.join("\n");
}
