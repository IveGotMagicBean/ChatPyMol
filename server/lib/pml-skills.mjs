import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePmlCommands } from "./fs-store.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills"
);

const SKILL_INDEX = [
  { id: "safe-pml", keywords: [] },
  {
    id: "ligand-pocket",
    keywords: ["配体", "口袋", "ligand", "pocket", "结合位点", "活性位点"]
  },
  {
    id: "chain-coloring",
    keywords: ["按链", "链着色", "chain", "color", "颜色", "配色"]
  },
  {
    id: "publication-figure",
    keywords: [
      "论文",
      "发表",
      "publication",
      "figure",
      "白底",
      "高清",
      "出图",
      "好看",
      "美观",
      "高级",
      "配色方案",
      "视觉",
      "标签方案"
    ]
  },
  {
    id: "structure-alignment",
    keywords: ["比对", "叠合", "对齐", "align", "super", "cealign", "merge", "合并"]
  },
  {
    id: "interface-analysis",
    keywords: ["界面", "interface", "接触", "相互作用", "蛋白复合物"]
  }
];

let cache;

export async function selectPmlSkills(message) {
  const all = await loadSkills();
  const text = String(message).toLowerCase();
  const selected = [all.get("safe-pml")];
  for (const entry of SKILL_INDEX.slice(1)) {
    if (entry.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      selected.push(all.get(entry.id));
    }
  }
  return selected.filter(Boolean).slice(0, 3);
}

export function renderPmlSkills(skills) {
  return skills
    .map(
      (skill) =>
        `### 技能：${skill.title}（${skill.id}）\n${skill.instructions}`
    )
    .join("\n\n");
}

export function validatePmlSkillEdit({ edit, previousPml, structures }) {
  const pml = String(edit?.pml || "");
  if (/[<\[](?:object|selection|chain|residue|name)[>\]]/i.test(pml)) {
    throw new Error("技能校验失败：PML 中仍有未替换的占位符");
  }

  for (const command of parsePmlCommands(pml)) {
    if (!balanced(command)) {
      throw new Error(`技能校验失败：命令括号不匹配：${command}`);
    }
  }

  const previousMarkers = previousPml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  const nextMarkers = pml
    .split("\n")
    .filter((line) => line.trim().startsWith("# @chatpymol"));
  if (previousMarkers.some((line) => !nextMarkers.includes(line))) {
    throw new Error("技能校验失败：结构管理行被删除");
  }
  if (nextMarkers.some((line) => !previousMarkers.includes(line))) {
    throw new Error("技能校验失败：AI 不得新增或伪造结构管理行");
  }

  const objects = new Set(structures.map((item) => item.objectName));
  for (const command of parsePmlCommands(pml)) {
    const match = command.match(/^(?:align|super)\s+([^,\s]+)\s*,\s*([^,\s]+)/i);
    if (!match) continue;
    for (const objectName of match.slice(1)) {
      if (!objects.has(objectName)) {
        throw new Error(`技能校验失败：比对命令引用了未知对象 ${objectName}`);
      }
    }
  }

  const knownChains = new Set(
    structures.flatMap((item) =>
      (item.metadata?.chains || []).map((chain) => String(chain.id))
    )
  );
  if (knownChains.size) {
    const previousCommands = new Set(parsePmlCommands(previousPml));
    for (const command of parsePmlCommands(pml)) {
      if (previousCommands.has(command)) continue;
      for (const match of command.matchAll(/\bchain\s+([A-Za-z0-9_.-]+)/gi)) {
        if (!knownChains.has(match[1])) {
          throw new Error(
            `技能校验失败：命令引用了结构中不存在的链 ${match[1]}`
          );
        }
      }
    }
  }
}

async function loadSkills() {
  if (cache) return cache;
  cache = new Map();
  for (const entry of SKILL_INDEX) {
    const source = await readFile(path.join(root, entry.id, "SKILL.md"), "utf8");
    const title = source.match(/^title:\s*(.+)$/m)?.[1]?.trim() || entry.id;
    const instructions = source.replace(/^---[\s\S]*?---\s*/m, "").trim();
    cache.set(entry.id, { id: entry.id, title, instructions });
  }
  return cache;
}

function balanced(command) {
  let depth = 0;
  for (const character of command) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
