import { ParsedGraph, ParseResult, StateVizDirective } from "./types";

const STATE_GRAPH_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*StateGraph\s*\(/;
const COMPILE_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.compile\s*\(/;
const METHOD_CALL_PATTERN =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\.(add_node|add_edge|add_conditional_edges|set_entry_point|set_finish_point)\s*\((.*)\)\s*$/;
const LANGGRAPH_IMPORT_PATTERN = /\bfrom\s+langgraph\b|\bimport\s+langgraph\b/;

interface GraphAccumulator {
  builderName: string;
  compiledNames: string[];
  nodes: Map<string, string>;
  edges: Array<{ from: string; to: string; label?: string; conditional?: boolean }>;
  warnings: string[];
}

const GRAPH_MARKER_PATTERN = /^\s*#\s*stateviz:\s*graph\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/m;

function splitTopLevelArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quote) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") {
      depthParen += 1;
    } else if (char === ")") {
      depthParen -= 1;
    } else if (char === "[") {
      depthBracket += 1;
    } else if (char === "]") {
      depthBracket -= 1;
    } else if (char === "{") {
      depthBrace += 1;
    } else if (char === "}") {
      depthBrace -= 1;
    }

    if (
      char === "," &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function unquote(value: string): string | undefined {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return undefined;
}

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = unquote(trimmed);
  if (unquoted) {
    return unquoted;
  }

  if (trimmed === "START") {
    return "__start__";
  }
  if (trimmed === "END") {
    return "__end__";
  }

  return trimmed;
}

function ensureSpecialNodes(accumulator: GraphAccumulator): void {
  accumulator.nodes.set("__start__", "START");
  accumulator.nodes.set("__end__", "END");
}

function ensureNode(accumulator: GraphAccumulator, nodeId: string, label?: string): void {
  if (!accumulator.nodes.has(nodeId)) {
    accumulator.nodes.set(nodeId, label ?? nodeId);
  }
}

function parseConditionalTargets(
  source: string,
): Array<{ label?: string; target: string }> | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return splitTopLevelArgs(inner).map((entry) => {
    const colonIndex = entry.indexOf(":");
    if (colonIndex === -1) {
      return {
        target: normalizeEndpoint(entry),
      };
    }
    const key = entry.slice(0, colonIndex).trim();
    const value = entry.slice(colonIndex + 1).trim();
    return {
      label: unquote(key) ?? key,
      target: normalizeEndpoint(value),
    };
  });
}

function parseListTargets(source: string): string[] | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return splitTopLevelArgs(inner).map((entry) => normalizeEndpoint(entry));
}

function pushEdge(
  accumulator: GraphAccumulator,
  from: string,
  to: string,
  label?: string,
  conditional = false,
): void {
  ensureNode(accumulator, from);
  ensureNode(accumulator, to);
  accumulator.edges.push({ from, to, label, conditional });
}

function parseAddNode(accumulator: GraphAccumulator, args: string): void {
  const [firstArg] = splitTopLevelArgs(args);
  if (!firstArg) {
    accumulator.warnings.push(
      `Skipped ${accumulator.builderName}.add_node(...) because no node name was found.`,
    );
    return;
  }

  const nodeName = unquote(firstArg);
  if (!nodeName) {
    accumulator.warnings.push(
      `Skipped ${accumulator.builderName}.add_node(...) because the node name is not a string literal.`,
    );
    return;
  }

  ensureNode(accumulator, nodeName, nodeName);
}

function parseAddEdge(accumulator: GraphAccumulator, args: string): void {
  const [source, target] = splitTopLevelArgs(args);
  if (!source || !target) {
    accumulator.warnings.push(
      `Skipped ${accumulator.builderName}.add_edge(...) because source or target is missing.`,
    );
    return;
  }
  pushEdge(accumulator, normalizeEndpoint(source), normalizeEndpoint(target));
}

function parseConditionalEdges(accumulator: GraphAccumulator, args: string): void {
  const parts = splitTopLevelArgs(args);
  if (parts.length < 2) {
    accumulator.warnings.push(
      `Skipped ${accumulator.builderName}.add_conditional_edges(...) because the call is incomplete.`,
    );
    return;
  }

  const source = normalizeEndpoint(parts[0]);
  const mappingArg = parts[2];
  const listTargets = parts[2] ? parseListTargets(parts[2]) : undefined;
  const dictTargets = parts[2] ? parseConditionalTargets(parts[2]) : undefined;

  if (dictTargets) {
    for (const target of dictTargets) {
      pushEdge(accumulator, source, target.target, target.label, true);
    }
    return;
  }

  if (listTargets) {
    for (const target of listTargets) {
      pushEdge(accumulator, source, target, "conditional", true);
    }
    return;
  }

  if (mappingArg) {
    accumulator.warnings.push(
      `Parsed ${accumulator.builderName}.add_conditional_edges(...) without static targets; only literal dict/list mappings are supported.`,
    );
    return;
  }

  accumulator.warnings.push(
    `Parsed ${accumulator.builderName}.add_conditional_edges(...) without a target map; no outgoing conditional edges were added.`,
  );
}

function finalizeGraphs(builders: Map<string, GraphAccumulator>): ParsedGraph[] {
  return [...builders.values()]
    .map((builder, index) => {
      ensureSpecialNodes(builder);
      return {
        id: `${builder.builderName}-${index + 1}`,
        title: builder.compiledNames[0] ?? builder.builderName,
        builderName: builder.builderName,
        compiledName: builder.compiledNames[0],
        warnings: builder.warnings,
        nodes: [...builder.nodes.entries()].map(([id, label]) => {
          const kind: "start" | "end" | "node" =
            id === "__start__" ? "start" : id === "__end__" ? "end" : "node";
          return { id, label, kind };
        }),
        edges: builder.edges,
      };
    })
    .filter((graph) => graph.nodes.length > 2 || graph.edges.length > 0);
}

export function parseLangGraphStateGraphs(
  source: string,
  marker: string,
): ParseResult {
  const directive = parseStateVizDirective(source, marker);
  if (!directive.enabled) {
    return {
      status: "missing-marker",
      graphs: [],
      warnings: [],
      message: `Add ${marker} to opt this file into StateViz.`,
    };
  }

  const builders = new Map<string, GraphAccumulator>();
  const lines = source.split(/\r?\n/);

  for (const line of lines) {
    const withoutComment = line.split("#")[0]?.trimEnd() ?? "";
    if (!withoutComment.trim()) {
      continue;
    }

    const stateGraphMatch = withoutComment.match(STATE_GRAPH_PATTERN);
    if (stateGraphMatch) {
      const builderName = stateGraphMatch[1];
      builders.set(builderName, {
        builderName,
        compiledNames: [],
        nodes: new Map<string, string>(),
        edges: [],
        warnings: [],
      });
      continue;
    }

    const compileMatch = withoutComment.match(COMPILE_PATTERN);
    if (compileMatch) {
      const compiledName = compileMatch[1];
      const builderName = compileMatch[2];
      builders.get(builderName)?.compiledNames.push(compiledName);
      continue;
    }

    const methodMatch = withoutComment.match(METHOD_CALL_PATTERN);
    if (!methodMatch) {
      continue;
    }

    const [, builderName, methodName, rawArgs] = methodMatch;
    const accumulator = builders.get(builderName);
    if (!accumulator) {
      continue;
    }

    switch (methodName) {
      case "add_node":
        parseAddNode(accumulator, rawArgs);
        break;
      case "add_edge":
        parseAddEdge(accumulator, rawArgs);
        break;
      case "set_entry_point":
        pushEdge(accumulator, "__start__", normalizeEndpoint(rawArgs));
        break;
      case "set_finish_point":
        pushEdge(accumulator, normalizeEndpoint(rawArgs), "__end__");
        break;
      case "add_conditional_edges":
        parseConditionalEdges(accumulator, rawArgs);
        break;
      default:
        accumulator.warnings.push(`Unsupported method ${methodName}.`);
    }
  }

  const graphs = finalizeGraphs(builders);
  if (graphs.length === 0) {
    return {
      status: "no-graph",
      graphs: [],
      warnings: [],
      message: "No supported LangGraph StateGraph pattern was found in this file.",
    };
  }

  const warnings = graphs.flatMap((graph) => graph.warnings);
  return {
    status: "success",
    graphs,
    warnings,
    message:
      graphs.length === 1
        ? "Detected 1 StateGraph."
        : `Detected ${graphs.length} StateGraph instances.`,
  };
}

export function parseStateVizDirective(
  source: string,
  marker: string,
): StateVizDirective {
  const runtimeMatch = source.match(GRAPH_MARKER_PATTERN);
  if (runtimeMatch) {
    return {
      enabled: true,
      runtimeSymbol: runtimeMatch[1],
    };
  }

  if (source.includes(marker)) {
    return {
      enabled: true,
    };
  }

  if (
    STATE_GRAPH_PATTERN.test(source) ||
    COMPILE_PATTERN.test(source) ||
    LANGGRAPH_IMPORT_PATTERN.test(source)
  ) {
    return {
      enabled: true,
    };
  }

  return {
    enabled: false,
  };
}
