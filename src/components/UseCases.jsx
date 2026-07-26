import { useState } from "react";
import {
  BookOpenCheck,
  CirclePlay,
  Dna,
  FlaskConical,
  GraduationCap,
  LoaderCircle,
  Sparkles,
  X
} from "lucide-react";
import "./UseCases.css";

const CASES = [
  {
    id: "first-look",
    pdbId: "1CRN",
    icon: GraduationCap,
    level: "新手 · 约 30 秒",
    title: "第一次看懂蛋白结构",
    description: "载入小型蛋白 Crambin，用渐变色展示主链走向，适合第一次体验旋转、缩放与选择。",
    prompt: "把蛋白显示成适合初学者观察的彩虹色卡通图",
    commands: (objectName) => [
      `hide everything, ${objectName}`,
      `show cartoon, ${objectName}`,
      `spectrum count, rainbow, ${objectName}`,
      "bg_color white",
      `orient ${objectName}`,
      `zoom ${objectName}, 4`
    ]
  },
  {
    id: "heme-pocket",
    pdbId: "4HHB",
    icon: FlaskConical,
    level: "科研 · 配体口袋",
    title: "血红蛋白与血红素口袋",
    description: "突出血红素配体和 4.5 Å 内的口袋残基，演示可直接继续编辑的科研分析场景。",
    prompt: "显示血红蛋白的血红素配体和周围 4.5 Å 口袋",
    commands: (objectName) => [
      `hide everything, ${objectName}`,
      `show cartoon, ${objectName}`,
      `color gray70, ${objectName}`,
      `select heme, ${objectName} and resn HEM`,
      "show sticks, heme",
      "color orange, heme",
      `select heme_pocket, byres (${objectName} within 4.5 of heme)`,
      "show sticks, heme_pocket",
      "color teal, heme_pocket",
      "bg_color white",
      "orient heme",
      "zoom heme, 8"
    ]
  },
  {
    id: "protein-interface",
    pdbId: "6M0J",
    icon: Sparkles,
    level: "进阶 · 蛋白界面",
    title: "ACE2–RBD 结合界面",
    description: "用双色链和界面棒状残基展示蛋白–蛋白相互作用，适合汇报与论文图构思。",
    prompt: "用双色显示 ACE2 和 RBD，并突出界面残基",
    commands: (objectName) => [
      `hide everything, ${objectName}`,
      `show cartoon, ${objectName}`,
      `color teal, ${objectName} and chain A`,
      `color salmon, ${objectName} and chain E`,
      `select interface, byres ((${objectName} and chain A within 5 of ${objectName} and chain E) or (${objectName} and chain E within 5 of ${objectName} and chain A))`,
      "show sticks, interface",
      "color yellow, interface",
      "bg_color white",
      `orient ${objectName}`
    ]
  },
  {
    id: "dna",
    pdbId: "1BNA",
    icon: Dna,
    level: "趣味 · 核酸",
    title: "探索 DNA 双螺旋",
    description: "一键载入经典 B-DNA，把两条链分色；不懂蛋白也能立即上手拖动观察。",
    prompt: "展示 DNA 双螺旋，并把两条链用不同颜色区分",
    commands: (objectName) => [
      `hide everything, ${objectName}`,
      `show cartoon, ${objectName}`,
      `show sticks, ${objectName}`,
      `color cyan, ${objectName} and chain A`,
      `color violet, ${objectName} and chain B`,
      "bg_color black",
      `orient ${objectName}`,
      `zoom ${objectName}, 6`
    ]
  }
];

export function UseCases({ open, onClose, api, workspace, onWorkspace, onError }) {
  const [running, setRunning] = useState("");

  if (!open) return null;

  async function runCase(item) {
    setRunning(item.id);
    try {
      let current = workspace;
      let structure = current.structures.find((entry) =>
        entry.filename.toUpperCase().startsWith(item.pdbId)
      );
      if (!structure) {
        const fetched = await api.fetchRcsb(
          current.project.id,
          item.pdbId,
          "pdb"
        );
        current = fetched.workspace;
        structure = current.structures.find((entry) =>
          entry.filename.toUpperCase().startsWith(item.pdbId)
        );
      }
      if (!structure) throw new Error("结构下载成功，但未能找到对应的场景对象。");

      const nextPml = `${current.pml.trimEnd()}

# 使用案例：${item.title}
# 自然语言意图：${item.prompt}
${item.commands(structure.objectName).join("\n")}
`;
      const result = await api.savePml(
        current.project.id,
        nextPml,
        current.version.id,
        `运行案例：${item.title}`
      );
      onWorkspace(result.workspace);
      onClose();
    } catch (error) {
      onError(error.message);
    } finally {
      setRunning("");
    }
  }

  return (
    <div className="case-backdrop" onMouseDown={onClose}>
      <section
        className="case-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="使用案例"
      >
        <header className="case-header">
          <div>
            <span className="case-header-icon">
              <BookOpenCheck size={19} />
            </span>
            <div>
              <strong>从一个真实案例开始</strong>
              <p>系统会自动下载结构、生成 PML、渲染场景并保存版本。</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="case-intro">
          不必先学习命令。任选一个案例观察结果，再通过左侧自然语言或右侧 PML
          继续修改；所有步骤都可以在版本历史中恢复。
        </div>

        <div className="case-grid">
          {CASES.map((item) => {
            const Icon = item.icon;
            const isRunning = running === item.id;
            return (
              <article className="case-card" key={item.id}>
                <div className="case-card-top">
                  <span className="case-art">
                    <Icon size={23} />
                  </span>
                  <div>
                    <span>{item.level}</span>
                    <code>{item.pdbId}</code>
                  </div>
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <div className="case-prompt">
                  <Sparkles size={12} />
                  “{item.prompt}”
                </div>
                <button disabled={Boolean(running)} onClick={() => runCase(item)}>
                  {isRunning ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <CirclePlay size={15} />
                  )}
                  {isRunning ? "正在准备场景…" : "运行这个案例"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
