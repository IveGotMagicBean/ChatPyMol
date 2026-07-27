import { parsePmlCommands } from "./fs-store.mjs";
import { renderPmlSkills, selectPmlSkills, validatePmlSkillEdit } from "./pml-skills.mjs";

const DEFAULT_BAILIAN_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `你是 ChatPyMOL 中的分子可视化协作助手。

你的任务：
1. 根据用户指令修改完整 PML 文档。
2. 保留无关的人工编辑，以及所有以 "# @chatpymol" 开头的结构管理行。
3. 返回简短中文说明、修改摘要和修改后的完整 PML。

规则：
- 只使用原生 PyMOL 命令。
- 优先使用可逆的显示、选择、颜色、标签、相机、测量和 set 命令。
- 禁止 Python 代码块、run、system、shell、quit、reinitialize、删除文件和网络访问。
- 不得编造上下文里不存在的对象名、链、残基、配体或科学事实。
- 结构 metadata 是唯一允许引用的链与异质分子清单；heteroGroups 只表示 HETATM 分组，不等同于已确认配体。
- 如果用户要求不存在或不明确的链、残基或异质分子，说明限制并保持相关 PML 不变。
- 指令有歧义时，采用最小且有用的视觉修改。
- PML 必须保持可人工编辑、可导出。
- 只返回 JSON，不要使用 Markdown 代码块。

JSON 格式：
{"assistantMessage":"中文说明","summary":"简短中文摘要","conversationTitle":"不超过18个字的对话标题","pml":"完整 PML"}`;

export async function proposePmlEdit({
  message,
  pml,
  scene,
  structures,
  history
}) {
  const compactPml = compactLegacyPml(pml);
  const context = buildContext({ pml: compactPml, scene, structures });
  const recentHistory = history.slice(-11, -1).map(({ role, content }) => ({
    role,
    content
  }));
  const skills = await selectPmlSkills(message);
  const skillPrompt = renderPmlSkills(skills);
  const instantAnswer = tryInstantWorkspaceAnswer(message, compactPml);
  if (instantAnswer) {
    return {
      ...instantAnswer,
      skills: skills.map(({ id, title }) => ({ id, title }))
    };
  }
  const fastEdit = tryFastColorEdit(message, compactPml, structures);
  if (fastEdit) {
    validateAiEdit(fastEdit, compactPml);
    validatePmlSkillEdit({
      edit: fastEdit,
      previousPml: compactPml,
      structures
    });
    return {
      ...fastEdit,
      skills: skills.map(({ id, title }) => ({ id, title }))
    };
  }

  if (process.env.DASHSCOPE_API_KEY) {
    return compatibleChatEdit({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseUrl:
        process.env.BAILIAN_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: process.env.BAILIAN_MODEL || "qwen3.7-max",
      mode: "bailian",
      message,
      context,
      recentHistory,
      skills,
      skillPrompt,
      structures,
      previousPml: compactPml
    });
  }

  if (process.env.OPENAI_API_KEY) {
    return openAiResponsesEdit({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      message,
      context,
      recentHistory,
      skills,
      skillPrompt,
      structures,
      previousPml: compactPml
    });
  }

  const local = localEdit(message, compactPml, structures);
  validatePmlSkillEdit({
    edit: local,
    previousPml: compactPml,
    structures
  });
  return { ...local, skills: skills.map(({ id, title }) => ({ id, title })) };
}

async function compatibleChatEdit({
  apiKey,
  baseUrl,
  model,
  mode,
  message,
  context,
  recentHistory,
  previousPml,
  skills,
  skillPrompt,
  structures
}) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(
      `${String(baseUrl).replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(bailianTimeoutMs()),
        body: JSON.stringify({
          model,
          temperature: 0.15,
          enable_thinking: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${SYSTEM_PROMPT}\n\n${skillPrompt}` },
            ...recentHistory,
            {
              role: "user",
              content: `当前工作区：\n${JSON.stringify(
                context
              )}\n\n用户要求：\n${message}`
            }
          ]
        })
      }
    );
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      console.info(
        `[ai] provider=bailian model=${model} thinking=false outcome=timeout elapsedMs=${Date.now() - startedAt}`
      );
      throw new Error(
        `百炼暂时繁忙，${bailianTimeoutMs() / 1000} 秒内未完成响应，请稍后重试`
      );
    }
    throw error;
  }
  if (!response.ok) throw await providerError(response, "百炼");
  const result = await response.json();
  const outputText = result.choices?.[0]?.message?.content;
  if (!outputText) throw new Error("百炼没有返回文本内容");
  console.info(
    `[ai] provider=bailian model=${model} thinking=false outcome=success elapsedMs=${Date.now() - startedAt} outputTokens=${result.usage?.completion_tokens ?? "?"}`
  );
  const parsed = parseJsonOutput(outputText);
  parsed.pml = stripAddedManagedLines(parsed.pml, previousPml);
  validateAiEdit(parsed, previousPml);
  validatePmlSkillEdit({ edit: parsed, previousPml, structures });
  return { ...parsed, mode, model, skills: skills.map(({ id, title }) => ({ id, title })) };
}

async function openAiResponsesEdit({
  apiKey,
  baseUrl,
  model,
  message,
  context,
  recentHistory,
  previousPml,
  skills,
  skillPrompt,
  structures
}) {
  const response = await fetch(
    `${String(baseUrl).replace(/\/+$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
                ,
                conversationTitle: { type: "string" }
              },
              required: ["assistantMessage", "pml", "summary", "conversationTitle"]
            }
          }
        },
        input: [
          { role: "developer", content: `${SYSTEM_PROMPT}\n\n${skillPrompt}` },
          ...recentHistory,
          {
            role: "user",
            content: `当前工作区：\n${JSON.stringify(
              context
            )}\n\n用户要求：\n${message}`
          }
        ]
      })
    }
  );
  if (!response.ok) throw await providerError(response, "OpenAI");
  const result = await response.json();
  const outputText =
    result.output_text ||
    result.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI 没有返回文本内容");
  const parsed = parseJsonOutput(outputText);
  parsed.pml = stripAddedManagedLines(parsed.pml, previousPml);
  validateAiEdit(parsed, previousPml);
  validatePmlSkillEdit({ edit: parsed, previousPml, structures });
  return { ...parsed, mode: "openai", model, skills: skills.map(({ id, title }) => ({ id, title })) };
}

function buildContext({ pml, scene, structures }) {
  const { commands: _duplicateCommands, ...sceneSummary } = scene || {};
  return {
    structures: structures.map(
      ({ filename, objectName, format, sha256, metadata }) => ({
        filename,
        objectName,
        format,
        sha256,
        metadata
      })
    ),
    scene: sceneSummary,
    currentPml: pml
  };
}

function bailianTimeoutMs() {
  const configured = Number(process.env.BAILIAN_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_BAILIAN_TIMEOUT_MS;
  return Math.min(120_000, Math.max(5_000, Math.round(configured)));
}

function stripAddedManagedLines(nextPml, previousPml) {
  const allowed = new Set(
    String(previousPml || "")
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("# @chatpymol"))
  );
  return String(nextPml || "")
    .split(/\r?\n/)
    .filter(
      (line) => !line.trim().startsWith("# @chatpymol") || allowed.has(line)
    )
    .join("\n");
}

function parseJsonOutput(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function providerError(response, provider) {
  const detail = await response.text();
  return new Error(
    `${provider}调用失败（${response.status}）：${detail.slice(0, 500)}`
  );
}

function validateAiEdit(edit, previousPml) {
  if (
    !edit ||
    typeof edit.pml !== "string" ||
    typeof edit.assistantMessage !== "string" ||
    typeof edit.summary !== "string" ||
    typeof edit.conversationTitle !== "string"
  ) {
    throw new Error("模型返回的 PML 修改格式不正确");
  }
  const previousManaged = previousPml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  const nextManaged = edit.pml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  if (previousManaged.some((line) => !nextManaged.includes(line))) {
    throw new Error("模型删除了受保护的结构管理行");
  }
  const forbidden = parsePmlCommands(edit.pml).find((command) =>
    /^(run|system|shell|quit|reinitialize|python|python end)\b/i.test(command)
  );
  if (forbidden) throw new Error(`模型生成了被禁止的命令：${forbidden}`);
}

export function compactLegacyPml(pml) {
  const lines = String(pml || "").split(/\r?\n/);
  const result = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!/^_\s+set_view\s*\(/i.test(trimmed)) {
      if (!/^_\s+/.test(trimmed)) result.push(lines[index]);
      continue;
    }

    while (result.at(-1)?.trim() === "") result.pop();
    if (result.at(-1)?.trim() === "# PyMOL 原生界面操作") result.pop();
    while (index + 1 < lines.length && /^_\s+/.test(lines[index + 1].trim())) {
      index += 1;
    }
  }

  return result.join("\n");
}

function tryInstantWorkspaceAnswer(message, pml) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const asksAboutFormats =
    /(?:pdb|mmcif|pml|pse)/i.test(lower) &&
    /(?:什么|啥|区别|用途|用来|干嘛|含义|格式|文件|what|difference|used for)/i.test(
      lower
    ) &&
    !/(?:改成|设成|显示|隐藏|高亮|测量|对齐|加载|删除|导出|下载)/i.test(
      lower
    );

  if (asksAboutFormats) {
    return {
      assistantMessage:
        "简单说：PDB/mmCIF 是原始原子坐标；PML 是可阅读、可修改、可复现配色与显示方式的 PyMOL 命令脚本；PSE 是可直接在桌面 PyMOL 打开的完整会话，会把结构、样式和视角一起保存。",
      summary: "说明 PDB、PML 与 PSE 的区别",
      conversationTitle: "文件格式说明",
      pml,
      mode: "instant",
      model: null
    };
  }

  const asksForLastCommand =
    /(?:刚才|上一步|最近).*(?:命令|指令|command)|(?:命令|指令|command).*(?:刚才|上一步|最近)/i.test(
      lower
    );

  if (asksForLastCommand) {
    const command = [...parsePmlCommands(pml)]
      .reverse()
      .find(
        (candidate) =>
          !/^(?:load|fetch|set_view|viewport|zoom|orient)\b/i.test(candidate)
      );
    return {
      assistantMessage: command
        ? `当前 PML 中最近的一条场景修改命令是：${command}`
        : "当前 PML 中还没有可说明的场景修改命令。",
      summary: "说明最近使用的 PyMOL 命令",
      conversationTitle: "PyMOL 命令说明",
      pml,
      mode: "instant",
      model: null
    };
  }

  return null;
}

function tryFastColorEdit(message, pml, structures) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!text || /[\n;；,，、]/.test(text)) return null;

  const color = findColor(lower);
  if (!color || countColorMentions(lower) !== 1) return null;
  if (
    !/(?:改|变|设(?:置)?|调|染|涂|换|着色)(?:成|为)?|\b(?:color|colour|make|turn|set)\b/i.test(
      lower
    )
  ) {
    return null;
  }

  if (
    /(?:并且|同时|然后|随后|再(?:把|将|给|显示|隐藏|对齐|比对)|顺便|以及|还要|另外|不要|不想|别把|无需|是否|能不能|可以吗|为什么|怎么|如何|解释|分析|比较|对齐|比对|叠合|合并|隐藏|表面|卡通|棒状|棍状|球状|线状|标签|选择|测量|距离|口袋|配体|下载|导出|删除|移除|背景|透明|旋转|缩放|居中|聚焦|\b(?:and|then|also|not|don't|do not|without|whether|why|how|explain|analy[sz]e|compare|align|super|merge|hide|show|surface|cartoon|stick|sphere|label|select|measure|distance|pocket|ligand|download|export|delete|remove|background|transparent|rotate|zoom|focus)\b)/i.test(
      lower
    )
  ) {
    return null;
  }

  const chainMatches = [
    ...text.matchAll(
      /(?:\bchain\s+([A-Za-z0-9_.-]+)|([A-Za-z0-9_.-]+)\s*链|链\s*([A-Za-z0-9_.-]+))/gi
    )
  ];
  if (chainMatches.length > 1) return null;
  const chain = chainMatches[0]?.slice(1).find(Boolean) || null;
  if (chain) {
    const knownChains = new Set(
      structures.flatMap((item) =>
        (item.metadata?.chains || []).map((entry) => String(entry.id))
      )
    );
    if (knownChains.size && !knownChains.has(chain)) return null;
  }

  const selection = chain ? `chain ${chain}` : "all";
  const command = `color ${color}, ${selection}`;
  const label = chain ? `${chain} 链` : "当前结构";
  const colorName = displayColorName(color);
  const summary = `${label}改为${colorName}`;

  return {
    assistantMessage: `已将${label}改为${colorName}。`,
    summary,
    conversationTitle: `${label}${colorName}着色`.slice(0, 18),
    pml: `${pml.trimEnd()}\n\n# AI quick edit\n${command}\n`,
    mode: "instant",
    model: null
  };
}

function localEdit(message, pml, structures) {
  const text = message.trim();
  const lower = text.toLowerCase();
  const commands = [];
  let explanation =
    "已用本地规则更新场景。在服务器 .env 中配置百炼 API Key 后即可启用完整自然语言理解。";

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

  const color = findColor(lower);
  const chain = text.match(/(?:chain|链)\s*([A-Za-z0-9]+)/i)?.[1];
  if (color) commands.push(`color ${color}, ${chain ? `chain ${chain}` : "all"}`);
  if (chain && !color) commands.push(`zoom chain ${chain}`);

  if (!commands.length) {
    return {
      assistantMessage:
        "百炼尚未配置，本地规则无法可靠理解这条指令；现有 PML 没有被覆盖。",
      summary: "场景未修改",
      conversationTitle: text.replace(/\s+/g, " ").slice(0, 18),
      pml,
      mode: "local"
    };
  }

  const unique = [...new Set(commands)];
  const objectHint = structures.length
    ? `\n# Objects: ${structures.map((item) => item.objectName).join(", ")}`
    : "";
  return {
    assistantMessage: `${explanation}\n执行：${unique.join("；")}`,
    summary: text.slice(0, 100),
    conversationTitle: text.replace(/\s+/g, " ").slice(0, 18),
    pml: `${pml.trimEnd()}${objectHint}\n\n# AI edit\n${unique.join("\n")}\n`,
    mode: "local"
  };
}

function findColor(text) {
  const colors = [
    ["粉红色", "pink"],
    ["粉红", "pink"],
    ["粉色", "pink"],
    ["pink", "pink"],
    ["玫红色", "magenta"],
    ["玫红", "magenta"],
    ["magenta", "magenta"],
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

function countColorMentions(text) {
  const aliases = [
    "粉红色",
    "粉红",
    "粉色",
    "pink",
    "玫红色",
    "玫红",
    "magenta",
    "red",
    "红",
    "blue",
    "蓝",
    "cyan",
    "青",
    "green",
    "绿",
    "yellow",
    "黄",
    "orange",
    "橙",
    "purple",
    "紫",
    "grey",
    "gray",
    "灰",
    "white",
    "白",
    "black",
    "黑"
  ];
  const occupied = [];
  for (const alias of aliases) {
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf(alias, offset);
      if (index < 0) break;
      const end = index + alias.length;
      if (!occupied.some(([start, finish]) => index < finish && end > start)) {
        occupied.push([index, end]);
      }
      offset = index + Math.max(alias.length, 1);
    }
  }
  return occupied.length;
}

function displayColorName(color) {
  return (
    {
      pink: "粉红色",
      magenta: "玫红色",
      red: "红色",
      blue: "蓝色",
      cyan: "青色",
      green: "绿色",
      yellow: "黄色",
      orange: "橙色",
      violet: "紫色",
      gray70: "灰色",
      white: "白色",
      black: "黑色"
    }[color] || color
  );
}
