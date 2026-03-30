import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RuntimeGraphResult } from "./types";

const execFileAsync = promisify(execFile);

export async function resolvePythonInterpreter(
  document: vscode.TextDocument,
): Promise<string> {
  const extension = vscode.extensions.getExtension("ms-python.python");
  if (extension) {
    try {
      const pythonExtension = extension.isActive
        ? extension
        : await extension.activate();
      const api = pythonExtension?.exports;
      const environmentPath =
        api?.environments?.getActiveEnvironmentPath?.(document.uri) ??
        api?.settings?.getExecutionDetails?.(document.uri)?.execCommand?.[0];
      if (typeof environmentPath === "string" && environmentPath.trim()) {
        return environmentPath;
      }
      const environment = await api?.environments?.resolveEnvironment?.(environmentPath);
      const resolvedPath = environment?.executable?.uri?.fsPath;
      if (typeof resolvedPath === "string" && resolvedPath.trim()) {
        return resolvedPath;
      }
    } catch {
      // Fall through to command/config-based resolution.
    }
  }

  let commandInterpreter: string | undefined;
  try {
    commandInterpreter = await vscode.commands.executeCommand<string | undefined>(
      "python.interpreterPath",
    );
  } catch {
    commandInterpreter = undefined;
  }

  if (commandInterpreter && commandInterpreter.trim()) {
    return commandInterpreter;
  }

  const configuration = vscode.workspace.getConfiguration("python", document.uri);
  const configuredInterpreter =
    configuration.get<string>("defaultInterpreterPath") ??
    configuration.get<string>("pythonPath");

  if (configuredInterpreter && configuredInterpreter.trim()) {
    return configuredInterpreter;
  }

  return process.platform === "win32" ? "python" : "python3";
}

export async function inspectRuntimeGraph(options: {
  document: vscode.TextDocument;
  symbol?: string;
  helperPath: string;
}): Promise<RuntimeGraphResult> {
  const interpreter = await resolvePythonInterpreter(options.document);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(options.document.uri)?.uri.fsPath;
  const { stdout, stderr } = await execFileAsync(
    interpreter,
    [
      options.helperPath,
      options.document.fileName,
      options.symbol ?? "__AUTO__",
      ...(workspaceFolder ? [workspaceFolder] : []),
    ],
    {
      cwd: workspaceFolder,
      timeout: 20_000,
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }

  let parsed: RuntimeGraphResult;
  try {
    parsed = JSON.parse(stdout) as RuntimeGraphResult;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "unknown JSON parse failure";
    throw new Error(`StateViz could not parse runtime helper output: ${detail}`);
  }

  return {
    ...parsed,
    interpreter,
  };
}
