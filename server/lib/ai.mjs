import { parsePmlCommands } from "./fs-store.mjs";

const SYSTEM_PROMPT = `You are the molecular visualization collaborator inside ChatPyMOL.

Outcome:
- Update the complete PML document to satisfy the user's request.
- Preserve unrelated human edits and every managed "load" line.
- Return a short Chinese explanation and the full next PML.

Constraints:
- Use native PyMOL command syntax.
- Prefer reversible display, selection, color, label, camera, measurement, and setting commands.
- Never use Python blocks, run, system, shell, quit, reinitialize, file deletion, or network access.
- Do not invent object names, chains, residues, ligands, or scientific facts not present in the supplied context.
- If the request is ambiguous, make the smallest useful visual change.
- Keep comments that start with "# @chatpymol".
- The PML must remain directly editable and exportable.`;

export async function proposePmlEdit({
  message,
  pml,
  scene,
  structures,
  history
}) {
  if (!process.env.OPENAI_API_KEY) {
    return localEdit(message, pml, structures);
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const recentHistory = history.slice(-11, -1).map(({ role, content }) => ({
    role,
    content
  }));
  const context = {
    structures: structures.map(({ filename, objectName, format }) => ({
      filename,
      objectName,
      format
    })),
    scene,
    currentPml: pml
  };

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "pml_edit",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              assistantMessage: { type: "string" },
              pml: { type: "string" },
              summary: { type: "string" }
            },
            required: ["assistantMessage", "pml", "summary"]
          }
        }
      },
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        ...recentHistory,
        {
          role: "user",
          content: `Workspace context:\n${JSON.stringify(context)}\n\nRequest:\n${message}`
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  const result = await response.json();
  const outputText =
    result.output_text ||
    result.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("AI provider returned no text output");
  const parsed = JSON.parse(outputText);
  validateAiEdit(parsed, pml);
  return { ...parsed, mode: "openai", model };
}

function validateAiEdit(edit, previousPml) {
  if (
    !edit ||
    typeof edit.pml !== "string" ||
    typeof edit.assistantMessage !== "string" ||
    typeof edit.summary !== "string"
  ) {
    throw new Error("AI returned an invalid PML edit");
  }
  const previousManaged = previousPml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  const nextManaged = edit.pml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  if (previousManaged.some((line) => !nextManaged.includes(line))) {
    throw new Error("AI edit removed a managed structure marker");
  }
  const forbidden = parsePmlCommands(edit.pml).find((command) =>
    /^(run|system|shell|quit|reinitialize|python|python end)\b/i.test(command)
  );
  if (forbidden) throw new Error(`AI proposed a blocked command: ${forbidden}`);
}

function localEdit(message, pml, structures) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const commands = [];
  let explanation = "已用本地规则更新场景。配置 API key 后可启用完整自然语言理解。";

  if (/重置|初始化|reset/.test(lower)) {
    commands.push("hide everything", "show cartoon", "color marine", "orient");
  }
  if (/cartoon|卡通|二级结构/.test(lower)) commands.push("show cartoon");
  if (/surface|表面/.test(lower)) commands.push("show surface");
  if (/sticks?|棒状|棍状/.test(lower)) commands.push("show sticks");
  if (/spheres?|球状/.test(lower)) commands.push("show spheres");
  if (/lines?|线状/.test(lower)) commands.push("show lines");
  if (/隐藏.*水|hide.*water|remove.*water/.test(lower)) {
    commands.push("hide everything, solvent");
  }
  if (/配体|ligand/.test(lower)) {
    commands.push("select ligand, organic", "show sticks, ligand", "zoom ligand");
  }
  if (/口袋|pocket|周围/.test(lower)) {
    commands.push(
      "select pocket, byres (organic around 5)",
      "show sticks, pocket",
      "color cyan, pocket"
    );
  }
  if (/白色背景|white background/.test(lower)) commands.push("bg_color white");
  if (/黑色背景|black background/.test(lower)) commands.push("bg_color black");
  if (/透明背景|transparent/.test(lower)) {
    commands.push("set ray_opaque_background, off");
  }

  const color = findColor(lower);
  const chain = text.match(/(?:chain|链)\s*([A-Za-z0-9]+)/i)?.[1];
  if (color) {
    commands.push(`color ${color}, ${chain ? `chain ${chain}` : "all"}`);
  }
  if (chain && !color) commands.push(`zoom chain ${chain}`);

  if (!commands.length) {
    explanation =
      "当前没有配置 AI 服务，本地规则无法可靠理解这条指令；我保留了 PML，没有覆盖你的编辑。";
    return {
      assistantMessage: explanation,
      summary: "No scene change",
      pml,
      mode: "local"
    };
  }

  const unique = [...new Set(commands)];
  const objectHint = structures.length
    ? `\n# Objects: ${structures.map((item) => item.objectName).join(", ")}`
    : "";
  return {
    assistantMessage: `${explanation}\n\n执行：${unique.join("；")}`,
    summary: text.slice(0, 100),
    pml: `${pml.trimEnd()}${objectHint}\n\n# AI edit\n${unique.join("\n")}\n`,
    mode: "local"
  };
}

function findColor(text) {
  const colors = [
    ["红", "red"],
    ["red", "red"],
    ["蓝", "blue"],
    ["blue", "blue"],
    ["青", "cyan"],
    ["cyan", "cyan"],
    ["绿", "green"],
    ["green", "green"],
    ["黄", "yellow"],
    ["yellow", "yellow"],
    ["橙", "orange"],
    ["orange", "orange"],
    ["紫", "violet"],
    ["purple", "violet"],
    ["灰", "gray70"],
    ["grey", "gray70"],
    ["gray", "gray70"],
    ["白", "white"],
    ["black", "black"],
    ["黑", "black"]
  ];
  return colors.find(([needle]) => text.includes(needle))?.[1] ?? null;
}
