import * as vscode from "vscode";
import { graphToMermaid } from "./mermaid";
import { parseLangGraphStateGraphs } from "./parser";
import { ParseResult, ViewState } from "./types";

export class StateVizPanel {
  public static readonly viewType = "stateviz.preview";

  private panel?: vscode.WebviewPanel;
  private selectedGraphId?: string;
  private sourceDocumentUri?: string;
  private lastStateKey?: string;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async show(): Promise<void> {
    this.captureEditorContext(vscode.window.activeTextEditor);

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      StateVizPanel.viewType,
      "StateViz Preview",
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.context.extensionUri,
          vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "mermaid", "dist"),
        ],
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === "selectGraph" && typeof message.graphId === "string") {
        this.selectedGraphId = message.graphId;
        void this.refresh();
      }
    });

    this.panel.webview.html = this.getHtml(this.panel.webview);
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }

    this.panel.title = this.buildTitle();
    const state = await this.buildViewState();
    const stateKey = JSON.stringify({
      fileName: state.fileName,
      status: state.status,
      message: state.message,
      warnings: state.warnings,
      selectedGraphId: state.selectedGraphId,
      graphs: state.graphs.map((graph) => ({
        id: graph.id,
        title: graph.title,
        mermaid: graph.mermaid,
        warnings: graph.warnings,
      })),
    });
    const preserveViewport = this.lastStateKey === stateKey;
    this.lastStateKey = stateKey;
    this.panel.webview.postMessage({
      type: "state",
      payload: state,
      preserveViewport,
    });
  }

  private buildTitle(): string {
    const document = this.getSourceDocument();
    if (!document) {
      return "StateViz Preview";
    }

    return `StateViz: ${document.fileName.split(/[\\/]/).pop() ?? "Preview"}`;
  }

  public captureEditorContext(editor: vscode.TextEditor | undefined): boolean {
    if (editor?.document.languageId === "python") {
      const nextUri = editor.document.uri.toString();
      const changed = this.sourceDocumentUri !== nextUri;
      this.sourceDocumentUri = nextUri;
      return changed;
    }
    return false;
  }

  public shouldRefreshForDocument(document: vscode.TextDocument): boolean {
    return document.uri.toString() === this.sourceDocumentUri;
  }

  private getSourceDocument(): vscode.TextDocument | undefined {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument?.languageId === "python") {
      this.sourceDocumentUri = activeDocument.uri.toString();
      return activeDocument;
    }

    if (!this.sourceDocumentUri) {
      return undefined;
    }

    return vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === this.sourceDocumentUri,
    );
  }

  private async buildViewState(): Promise<ViewState> {
    const document = this.getSourceDocument();
    if (!document) {
      return {
        status: "no-active-editor",
        message: "Open a Python file, then run StateViz Preview to inspect a LangGraph StateGraph.",
        warnings: [],
        graphs: [],
      };
    }
    if (document.languageId !== "python") {
      return {
        fileName: document.fileName,
        status: "not-python",
        message: "StateViz only inspects Python files.",
        warnings: [],
        graphs: [],
      };
    }

    const marker = vscode.workspace
      .getConfiguration("stateviz")
      .get<string>("marker", "# stateviz: langgraph");

    let parseResult: ParseResult;
    try {
      parseResult = parseLangGraphStateGraphs(document.getText(), marker);
    } catch (error) {
      parseResult = {
        status: "parse-error",
        graphs: [],
        warnings: [],
        message:
          error instanceof Error ? error.message : "StateViz failed to parse the active file.",
      };
    }

    const graphs = parseResult.graphs.map((graph) => ({
      id: graph.id,
      title:
        graph.compiledName && graph.compiledName !== graph.builderName
          ? `${graph.title} (${graph.builderName})`
          : graph.title,
      mermaid: graphToMermaid(graph),
      warnings: graph.warnings,
    }));
    const selectedGraphId =
      graphs.find((graph) => graph.id === this.selectedGraphId)?.id ?? graphs[0]?.id;

    this.selectedGraphId = selectedGraphId;

    return {
      fileName: document.fileName,
      status: parseResult.status,
      message: parseResult.message,
      warnings: parseResult.warnings,
      graphs,
      selectedGraphId,
      updatedAt: new Date().toISOString(),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "mermaid",
        "dist",
        "mermaid.min.js",
      ),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${
        webview.cspSource
      } https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StateViz</title>
    <style>
      :root {
        color-scheme: dark;
        --panel-bg: #191d25;
        --surface-soft: #2b3240;
        --text-main: #e5e9f0;
        --text-muted: #9aa4b2;
        --amber: #d6ab58;
      }
      html, body {
        height: 100%;
      }
      body {
        font-family: var(--vscode-font-family);
        color: var(--text-main);
        background:
          radial-gradient(circle at top, rgba(187, 104, 255, 0.08), transparent 38%),
          radial-gradient(circle at bottom left, rgba(90, 164, 231, 0.09), transparent 34%),
          var(--panel-bg);
        margin: 0;
      }
      .shell {
        padding: 14px;
        display: grid;
        gap: 12px;
        min-height: 100%;
        box-sizing: border-box;
        grid-template-rows: auto auto auto minmax(420px, 1fr);
      }
      .card {
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015));
        border-radius: 16px;
        padding: 12px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      }
      .eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
      }
      .message {
        line-height: 1.45;
        margin: 0;
        color: var(--text-main);
      }
      .selector {
        width: 100%;
        padding: 7px 8px;
        border-radius: 10px;
        background: var(--surface-soft);
        color: var(--text-main);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .warnings {
        display: grid;
        gap: 8px;
      }
      .warning {
        border-left: 3px solid var(--amber);
        padding-left: 10px;
        color: var(--text-muted);
      }
      .graph-card {
        display: grid;
        grid-template-rows: auto minmax(380px, 1fr);
        min-height: 0;
      }
      .graph-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .toolbar-actions {
        display: flex;
        gap: 6px;
      }
      .toolbar-button {
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: var(--surface-soft);
        color: var(--text-main);
        border-radius: 10px;
        padding: 6px 10px;
        cursor: pointer;
      }
      .toolbar-button:hover {
        background: #31394a;
      }
      .graph-shell {
        border-radius: 18px;
        background:
          radial-gradient(circle at 50% 0%, rgba(187, 104, 255, 0.08), transparent 32%),
          linear-gradient(180deg, #1c212b, #171b22);
        border: 1px solid rgba(255, 255, 255, 0.06);
        min-height: 0;
        overflow: hidden;
        position: relative;
      }
      .graph-viewport {
        position: absolute;
        inset: 0;
        overflow: hidden;
        cursor: grab;
      }
      .graph-viewport.dragging {
        cursor: grabbing;
      }
      .graph-stage {
        position: absolute;
        top: 0;
        left: 0;
        will-change: transform;
      }
      .graph-stage svg {
        display: block;
        overflow: visible;
        user-select: none;
        -webkit-user-select: none;
      }
      .graph-stage .label {
        font-family: var(--vscode-font-family) !important;
        user-select: none;
        -webkit-user-select: none;
      }
      .graph-stage text,
      .graph-stage tspan,
      .graph-stage foreignObject,
      .graph-stage span {
        user-select: none;
        -webkit-user-select: none;
      }
      .graph-stage .edgeLabel,
      .graph-stage .labelBkg {
        background: transparent !important;
      }
      .graph-stage .cluster rect,
      .graph-stage .node rect,
      .graph-stage .node polygon,
      .graph-stage .node circle,
      .graph-stage .node path {
        filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.22));
      }
      .graph-stage .flowchart-link {
        stroke-width: 2.4px;
      }
      .graph-empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: var(--text-muted);
        text-align: center;
        padding: 24px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        color: var(--text-main);
      }
      .meta {
        font-size: 12px;
        color: var(--text-muted);
      }
      .hidden {
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="card">
        <div class="eyebrow">Active File</div>
        <h1 class="title" id="fileName">Waiting for a Python file</h1>
        <p class="message" id="statusMessage"></p>
        <p class="meta" id="updatedAt"></p>
      </section>
      <section class="card hidden" id="selectorCard">
        <div class="eyebrow">Graphs</div>
        <select class="selector" id="graphSelector"></select>
      </section>
      <section class="card hidden" id="warningsCard">
        <div class="eyebrow">Warnings</div>
        <div class="warnings" id="warnings"></div>
      </section>
      <section class="card graph-card hidden" id="graphCard">
        <div class="graph-toolbar">
          <div>
            <div class="eyebrow">Diagram</div>
            <div class="meta">Drag to pan. Use mouse wheel or controls to zoom.</div>
          </div>
          <div class="toolbar-actions">
            <button class="toolbar-button" id="zoomOutButton" type="button">-</button>
            <button class="toolbar-button" id="resetButton" type="button">Reset</button>
            <button class="toolbar-button" id="zoomInButton" type="button">+</button>
          </div>
        </div>
        <div class="graph-shell">
          <div class="graph-viewport" id="graphViewport">
            <div class="graph-stage" id="graphStage"></div>
            <div class="graph-empty hidden" id="graphEmpty">No graph to render.</div>
          </div>
        </div>
      </section>
    </div>

    <script nonce="${nonce}" src="${mermaidUri}"></script>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = { graphs: [], selectedGraphId: undefined };

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        flowchart: {
          curve: "basis"
        },
        themeVariables: {
          primaryColor: "#ede1cf",
          primaryTextColor: "#20170f",
          primaryBorderColor: "#6d4c1d",
          lineColor: "#8d4bd7",
          secondaryColor: "#d8e4ef",
          tertiaryColor: "#f5efe5",
          fontFamily: "var(--vscode-font-family)"
        }
      });

      const fileName = document.getElementById("fileName");
      const statusMessage = document.getElementById("statusMessage");
      const updatedAt = document.getElementById("updatedAt");
      const graphCard = document.getElementById("graphCard");
      const graphViewport = document.getElementById("graphViewport");
      const graphStage = document.getElementById("graphStage");
      const graphEmpty = document.getElementById("graphEmpty");
      const selectorCard = document.getElementById("selectorCard");
      const graphSelector = document.getElementById("graphSelector");
      const warningsCard = document.getElementById("warningsCard");
      const warnings = document.getElementById("warnings");
      const zoomInButton = document.getElementById("zoomInButton");
      const zoomOutButton = document.getElementById("zoomOutButton");
      const resetButton = document.getElementById("resetButton");
      const viewportState = {
        scale: 1,
        minScale: 0.35,
        maxScale: 2.8,
        x: 0,
        y: 0,
        isDragging: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        baseWidth: 0,
        baseHeight: 0
      };
      let currentGraphSignature = "";

      graphSelector.addEventListener("change", (event) => {
        const target = event.target;
        state.selectedGraphId = target.value;
        vscode.postMessage({ type: "selectGraph", graphId: target.value });
        renderGraph();
      });

      zoomInButton.addEventListener("click", () => zoomBy(1.15));
      zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.15));
      resetButton.addEventListener("click", () => centerGraph(true));
      window.addEventListener("resize", () => centerGraph(false));

      graphViewport.addEventListener("wheel", (event) => {
        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAtPoint(zoomFactor, event.clientX, event.clientY);
      }, { passive: false });

      graphViewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        viewportState.isDragging = true;
        viewportState.pointerId = event.pointerId;
        viewportState.startX = event.clientX;
        viewportState.startY = event.clientY;
        viewportState.initialX = viewportState.x;
        viewportState.initialY = viewportState.y;
        graphViewport.setPointerCapture(event.pointerId);
        graphViewport.classList.add("dragging");
      });

      graphViewport.addEventListener("pointermove", (event) => {
        if (!viewportState.isDragging || viewportState.pointerId !== event.pointerId) {
          return;
        }
        viewportState.x = viewportState.initialX + (event.clientX - viewportState.startX);
        viewportState.y = viewportState.initialY + (event.clientY - viewportState.startY);
        applyTransform();
      });

      graphViewport.addEventListener("pointerup", stopDragging);
      graphViewport.addEventListener("pointercancel", stopDragging);

      function stopDragging(event) {
        if (viewportState.pointerId !== event.pointerId) {
          return;
        }
        viewportState.isDragging = false;
        viewportState.pointerId = null;
        graphViewport.classList.remove("dragging");
      }

      function clampScale(scale) {
        return Math.min(viewportState.maxScale, Math.max(viewportState.minScale, scale));
      }

      function applyTransform() {
        graphStage.style.transform =
          "translate(" + viewportState.x + "px, " + viewportState.y + "px)";
        updateGraphScale();
      }

      function updateGraphScale() {
        const svg = graphStage.querySelector("svg");
        if (!svg || !viewportState.baseWidth || !viewportState.baseHeight) {
          return;
        }

        const width = viewportState.baseWidth * viewportState.scale;
        const height = viewportState.baseHeight * viewportState.scale;
        svg.style.width = width + "px";
        svg.style.height = height + "px";
        graphStage.style.width = width + "px";
        graphStage.style.height = height + "px";
      }

      function zoomBy(multiplier) {
        const rect = graphViewport.getBoundingClientRect();
        zoomAtPoint(multiplier, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }

      function zoomAtPoint(multiplier, clientX, clientY) {
        const nextScale = clampScale(viewportState.scale * multiplier);
        const rect = graphViewport.getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const offsetY = clientY - rect.top;
        const worldX = (offsetX - viewportState.x) / viewportState.scale;
        const worldY = (offsetY - viewportState.y) / viewportState.scale;
        viewportState.scale = nextScale;
        viewportState.x = offsetX - worldX * viewportState.scale;
        viewportState.y = offsetY - worldY * viewportState.scale;
        applyTransform();
      }

      function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }

      async function centerGraph(resetScale = false) {
        const svg = graphStage.querySelector("svg");
        if (!svg) {
          graphEmpty.classList.remove("hidden");
          return;
        }

        await nextFrame();
        await nextFrame();

        graphEmpty.classList.add("hidden");
        const rect = graphViewport.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        const width = Math.max(svgRect.width, 1);
        const height = Math.max(svgRect.height, 1);

        if (resetScale) {
          const fitScale = Math.min(
            (rect.width - 72) / width,
            (rect.height - 72) / height,
            1
          );
          viewportState.scale = clampScale(fitScale);
        }

        const scaledWidth = width * viewportState.scale;
        const scaledHeight = height * viewportState.scale;
        viewportState.x = Math.max((rect.width - scaledWidth) / 2, 24);
        viewportState.y = Math.max((rect.height - scaledHeight) / 2, 24);
        applyTransform();
      }

      async function renderGraph(preserveViewport = false) {
        const graph = state.graphs.find((entry) => entry.id === state.selectedGraphId);
        if (!graph) {
          graphCard.classList.add("hidden");
          graphStage.innerHTML = "";
          currentGraphSignature = "";
          return;
        }

        const nextSignature = JSON.stringify({
          id: graph.id,
          mermaid: graph.mermaid
        });
        if (preserveViewport && currentGraphSignature === nextSignature) {
          return;
        }

        graphCard.classList.remove("hidden");
        const renderId = "stateviz-" + graph.id.replace(/[^a-zA-Z0-9_-]/g, "-");
        try {
          const rendered = await mermaid.render(renderId, graph.mermaid);
          graphStage.innerHTML = rendered.svg;
          const svg = graphStage.querySelector("svg");
          if (svg) {
            await nextFrame();
            const box = svg.getBBox();
            viewportState.baseWidth = Math.max(box.width + box.x, 1);
            viewportState.baseHeight = Math.max(box.height + box.y, 1);
            svg.style.width = viewportState.baseWidth + "px";
            svg.style.height = viewportState.baseHeight + "px";
            graphStage.style.width = viewportState.baseWidth + "px";
            graphStage.style.height = viewportState.baseHeight + "px";
          }
          currentGraphSignature = nextSignature;
          await centerGraph(true);
        } catch (error) {
          graphStage.innerHTML = "<pre>" + String(error) + "</pre>";
          graphEmpty.classList.add("hidden");
          currentGraphSignature = "";
        }
      }

      function renderWarnings(allWarnings) {
        if (!allWarnings.length) {
          warningsCard.classList.add("hidden");
          warnings.innerHTML = "";
          return;
        }

        warningsCard.classList.remove("hidden");
        warnings.innerHTML = allWarnings
          .map((warning) => '<div class="warning">' + warning + "</div>")
          .join("");
      }

      function renderSelector() {
        if (state.graphs.length <= 1) {
          selectorCard.classList.add("hidden");
          graphSelector.innerHTML = "";
          return;
        }

        selectorCard.classList.remove("hidden");
        graphSelector.innerHTML = state.graphs
          .map((graph) => {
            const selected = graph.id === state.selectedGraphId ? " selected" : "";
            return '<option value="' + graph.id + '"' + selected + ">" + graph.title + "</option>";
          })
          .join("");
      }

      function renderView(payload) {
        state.graphs = payload.graphs;
        state.selectedGraphId = payload.selectedGraphId;
        fileName.textContent = payload.fileName ? payload.fileName.split(/[\\\\/]/).pop() : "Waiting for a Python file";
        statusMessage.textContent = payload.message;
        updatedAt.textContent = payload.updatedAt ? "Last update: " + new Date(payload.updatedAt).toLocaleTimeString() : "";
        renderSelector();
        renderWarnings([...(payload.warnings || []), ...(state.graphs.find((graph) => graph.id === state.selectedGraphId)?.warnings || [])]);
        void renderGraph(payload.preserveViewport === true);
      }

      window.addEventListener("message", (event) => {
        if (event.data?.type === "state") {
          renderView(event.data.payload);
        }
      });
    </script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 16; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
