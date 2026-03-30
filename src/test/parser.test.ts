import test from "node:test";
import assert from "node:assert/strict";
import { graphToMermaid } from "../mermaid";
import { parseLangGraphStateGraphs, parseStateVizDirective } from "../parser";

test("returns no graph when a file has no marker and no recognizable langgraph pattern", () => {
  const result = parseLangGraphStateGraphs("graph = StateGraph(State)", "# stateviz: langgraph");
  assert.equal(result.status, "no-graph");
  assert.equal(result.graphs.length, 0);
});

test("parses a basic StateGraph", () => {
  const source = `
# stateviz: langgraph
from langgraph.graph import StateGraph, START, END

builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("review", review)
builder.add_edge(START, "draft")
builder.add_edge("draft", "review")
builder.add_edge("review", END)
app = builder.compile()
`;

  const result = parseLangGraphStateGraphs(source, "# stateviz: langgraph");
  assert.equal(result.status, "success");
  assert.equal(result.graphs.length, 1);
  assert.equal(result.graphs[0].compiledName, "app");
  assert.equal(result.graphs[0].edges.length, 3);
});

test("parses multiple graphs in one file", () => {
  const source = `
# stateviz: langgraph
from langgraph.graph import StateGraph

first = StateGraph(State)
first.add_node("one", one)
first.set_entry_point("one")
first.set_finish_point("one")
workflow = first.compile()

second = StateGraph(State)
second.add_node("two", two)
second.set_entry_point("two")
`;

  const result = parseLangGraphStateGraphs(source, "# stateviz: langgraph");
  assert.equal(result.status, "success");
  assert.equal(result.graphs.length, 2);
});

test("collects warnings for unsupported conditional edges", () => {
  const source = `
# stateviz: langgraph
builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_conditional_edges("draft", route, route_map)
`;

  const result = parseLangGraphStateGraphs(source, "# stateviz: langgraph");
  assert.equal(result.status, "success");
  assert.match(result.warnings[0], /static targets/);
});

test("generates mermaid output", () => {
  const source = `
# stateviz: langgraph
builder = StateGraph(State)
builder.add_node("draft", draft)
builder.set_entry_point("draft")
builder.set_finish_point("draft")
`;

  const result = parseLangGraphStateGraphs(source, "# stateviz: langgraph");
  const mermaid = graphToMermaid(result.graphs[0]);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /__start__/);
  assert.match(mermaid, /draft/);
});

test("accepts explicit runtime graph markers", () => {
  const directive = parseStateVizDirective(
    "# stateviz: graph=app\nbuilder = StateGraph(State)",
    "# stateviz: langgraph",
  );
  assert.equal(directive.enabled, true);
  assert.equal(directive.runtimeSymbol, "app");
});

test("keeps runtime symbol optional for plain opt-in marker", () => {
  const directive = parseStateVizDirective(
    "# stateviz: langgraph\nbuilder = StateGraph(State)",
    "# stateviz: langgraph",
  );
  assert.equal(directive.enabled, true);
  assert.equal(directive.runtimeSymbol, undefined);
});

test("auto-enables for obvious langgraph files without a marker", () => {
  const directive = parseStateVizDirective(
    'from langgraph.graph import StateGraph\nbuilder = StateGraph(State)\napp = builder.compile()',
    "# stateviz: langgraph",
  );
  assert.equal(directive.enabled, true);
  assert.equal(directive.runtimeSymbol, undefined);
});

test("renders conditional edges as dashed mermaid links", () => {
  const source = `
# stateviz: langgraph
builder = StateGraph(State)
builder.add_node("agent", agent)
builder.add_node("tools", tools)
builder.set_entry_point("agent")
builder.add_conditional_edges("agent", route, {"end": END, "tools": "tools"})
`;

  const result = parseLangGraphStateGraphs(source, "# stateviz: langgraph");
  const mermaid = graphToMermaid(result.graphs[0]);
  assert.match(mermaid, /-\.\->\|end\|/);
  assert.match(mermaid, /-\.\->\|tools\|/);
});
