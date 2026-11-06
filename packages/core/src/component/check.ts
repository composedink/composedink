import ts from "typescript";
import { relative, join } from "node:path";
import { manifest } from "./manifest.ts";
import { compileFallback } from "../fallback/evaluator.ts";
import { materialize, packageDefinition } from "./workspace.ts";
export interface ComponentDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}
const programs = new Map<string, ts.Program>();
export async function checkComponent(
  home: string,
  id: string,
  files: Record<string, string>,
  prepared?: string,
) {
  const diagnostics: ComponentDiagnostic[] = [];
  const report = (file: string, error: unknown) => {
    const offset =
      typeof error === "object" && error && "offset" in error && typeof error.offset === "number"
        ? error.offset
        : 0;
    const before = (files[file] ?? "").slice(0, offset).split("\n");
    diagnostics.push({
      file,
      line: before.length,
      column: before.at(-1)!.length + 1,
      code: "ComponentCheck",
      message: String(error),
    });
  };
  try {
    packageDefinition(files);
  } catch (error) {
    report("package.json", error);
    return { ok: false, diagnostics };
  }
  let extracted;
  try {
    extracted = manifest(files["block.tsx"]);
  } catch (error) {
    report("block.tsx", error);
  }
  try {
    await compileFallback(files["fallback.ts"]);
  } catch (error) {
    report("fallback.ts", error);
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  try {
    const directory = prepared ?? (await materialize(home, id, files, { check: 1 })).directory;
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowImportingTsExtensions: true,
      types: ["react", "react-dom"],
      typeRoots: [join(directory, "node_modules/@types")],
    };
    const program = ts.createProgram(
      Object.keys(files)
        .filter((p) => /\.[cm]?tsx?$/.test(p))
        .map((p) => join(directory, p)),
      options,
      undefined,
      programs.get(home + id),
    );
    programs.set(home + id, program);
    for (const d of ts.getPreEmitDiagnostics(program)) {
      const position = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
      diagnostics.push({
        file: d.file ? relative(directory, d.file.fileName) : "package.json",
        line: (position?.line ?? 0) + 1,
        column: (position?.character ?? 0) + 1,
        code: `TS${d.code}`,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      });
    }
  } catch (error) {
    report("package.json", error);
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    ...(extracted ? { manifest: extracted } : {}),
  };
}
