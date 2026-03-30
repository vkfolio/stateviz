import json
import os
import runpy
import sys
from pathlib import Path

DEFAULT_ENV_VARS = {
    "OPENAI_API_KEY": "stateviz-placeholder-key",
    "ANTHROPIC_API_KEY": "stateviz-placeholder-key",
    "GOOGLE_API_KEY": "stateviz-placeholder-key",
    "GROQ_API_KEY": "stateviz-placeholder-key",
    "MISTRAL_API_KEY": "stateviz-placeholder-key",
    "COHERE_API_KEY": "stateviz-placeholder-key",
    "DEEPSEEK_API_KEY": "stateviz-placeholder-key",
    "LANGCHAIN_API_KEY": "stateviz-placeholder-key",
}


def node_kind(node_id: str) -> str:
    if node_id == "__start__":
        return "start"
    if node_id == "__end__":
        return "end"
    return "node"


def to_payload(symbol_name: str, compiled_graph) -> dict:
    if not hasattr(compiled_graph, "get_graph"):
        raise TypeError(
            f"Symbol '{symbol_name}' does not expose get_graph(); expected a compiled LangGraph object."
        )

    graph = compiled_graph.get_graph()

    nodes = []
    for node_id, node in graph.nodes.items():
        label = getattr(node, "name", node_id) or node_id
        nodes.append(
            {
                "id": node_id,
                "label": label,
                "kind": node_kind(node_id),
            }
        )

    edges = []
    for edge in graph.edges:
        label = getattr(edge, "data", None)
        if label is not None and not isinstance(label, str):
            label = str(label)
        conditional = bool(getattr(edge, "conditional", False))
        if conditional and not label:
            label = "conditional"
        edges.append(
            {
                "from": edge.source,
                "to": edge.target,
                "label": label,
                "conditional": conditional,
            }
        )

    return {
        "id": f"{symbol_name}-runtime",
        "title": symbol_name,
        "builderName": symbol_name,
        "compiledName": symbol_name,
        "warnings": [],
        "nodes": nodes,
        "edges": edges,
    }


def main() -> int:
    if len(sys.argv) not in {3, 4}:
        raise SystemExit("Usage: stateviz_runtime_helper.py <file> <symbol> [workspace_root]")

    file_path = Path(sys.argv[1]).resolve()
    symbol_name = sys.argv[2]
    workspace_root = Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else None

    for env_name, env_value in DEFAULT_ENV_VARS.items():
        os.environ.setdefault(env_name, env_value)

    candidate_paths = [file_path.parent]
    if workspace_root is not None:
        candidate_paths.append(workspace_root)

    for candidate in candidate_paths:
        candidate_str = str(candidate)
        if candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)

    namespace = runpy.run_path(str(file_path), run_name="__stateviz__")
    graphs = []
    selected_symbol = None

    if symbol_name != "__AUTO__":
        if symbol_name not in namespace:
            raise KeyError(
                f"StateViz could not find symbol '{symbol_name}' in {file_path.name}."
            )
        graphs.append(to_payload(symbol_name, namespace[symbol_name]))
        selected_symbol = symbol_name
    else:
        for candidate_name, candidate_value in namespace.items():
            if candidate_name.startswith("__"):
                continue
            if hasattr(candidate_value, "get_graph"):
                try:
                    graphs.append(to_payload(candidate_name, candidate_value))
                except Exception:
                    continue

        if not graphs:
            raise KeyError(
                f"StateViz could not find any compiled LangGraph object in {file_path.name}."
            )

    payload = {
        "graphs": graphs,
        "interpreter": sys.executable,
        "symbol": selected_symbol,
    }

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
