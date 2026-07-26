import { useEffect, useMemo, useState } from "react";
import {
  Atom,
  CheckCircle2,
  Database,
  GitCompareArrows,
  GitMerge,
  LoaderCircle,
  Search,
  Sparkles,
  X
} from "lucide-react";
import "./StructureHub.css";

export function StructureHub({
  open,
  onClose,
  api,
  workspace,
  onWorkspace,
  onError
}) {
  const [tab, setTab] = useState("library");
  const [pdbId, setPdbId] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState("");
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");

  useEffect(() => {
    if (!open) return;
    api
      .recommendations()
      .then((result) => setRecommendations(result.recommendations))
      .catch((error) => onError(error.message));
  }, [api, onError, open]);

  useEffect(() => {
    if (!workspace?.structures?.length) return;
    setFirstId((value) => value || workspace.structures[0]?.id || "");
    setSecondId((value) => value || workspace.structures[1]?.id || "");
  }, [workspace?.structures]);

  const first = useMemo(
    () => workspace?.structures.find((item) => item.id === firstId),
    [firstId, workspace]
  );
  const second = useMemo(
    () => workspace?.structures.find((item) => item.id === secondId),
    [secondId, workspace]
  );

  if (!open) return null;

  async function fetchProtein(id) {
    const normalized = String(id).trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      onError("请输入 4 位 PDB ID，例如 1UBQ。");
      return;
    }
    setLoading(normalized);
    try {
      const result = await api.fetchRcsb(
        workspace.project.id,
        normalized,
        "pdb"
      );
      onWorkspace(result.workspace);
      setPdbId("");
      onClose();
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading("");
    }
  }

  async function commitPair(action) {
    if (!first || !second || first.id === second.id) {
      onError("请选择两个不同的结构对象。");
      return;
    }
    const isAlign = action === "align";
    const command = isAlign
      ? `align ${second.objectName}, ${first.objectName}\norient ${first.objectName} or ${second.objectName}`
      : `create merged_${first.objectName}_${second.objectName}, ${first.objectName} or ${second.objectName}\nhide everything, ${first.objectName} or ${second.objectName}\nshow cartoon, merged_${first.objectName}_${second.objectName}\norient merged_${first.objectName}_${second.objectName}`;
    const nextPml = `${workspace.pml.trimEnd()}\n\n# 人工操作：${
      isAlign ? "结构比对" : "合并对象"
    }\n${command}\n`;
    setLoading(action);
    try {
      const result = await api.savePml(
        workspace.project.id,
        nextPml,
        workspace.version.id,
        isAlign
          ? `比对 ${second.objectName} 到 ${first.objectName}`
          : `合并 ${first.objectName} 与 ${second.objectName}`
      );
      onWorkspace(result.workspace);
      onClose();
    } catch (error) {
      onError(error.message);
    } finally {
      setLoading("");
    }
  }

  return (
    <div className="hub-backdrop" onMouseDown={onClose}>
      <section
        className="structure-hub"
        onMouseDown={(event) => event.stopPropagation()}
        aria-modal="true"
        role="dialog"
        aria-label="蛋白结构中心"
      >
        <header className="hub-header">
          <div>
            <span className="hub-icon">
              <Atom size={20} />
            </span>
            <div>
              <strong>蛋白结构中心</strong>
              <p>获取示例、自动下载，或组合当前场景中的结构。</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <nav className="hub-tabs">
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => setTab("library")}
          >
            <Database size={15} />
            获取与推荐
          </button>
          <button
            className={tab === "combine" ? "active" : ""}
            onClick={() => setTab("combine")}
          >
            <GitMerge size={15} />
            比对与合并
          </button>
        </nav>

        {tab === "library" ? (
          <div className="hub-content">
            <div className="pdb-search">
              <div>
                <Search size={17} />
                <input
                  value={pdbId}
                  onChange={(event) =>
                    setPdbId(event.target.value.toUpperCase().slice(0, 4))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") fetchProtein(pdbId);
                  }}
                  placeholder="输入 PDB ID，例如 1UBQ"
                  autoFocus
                />
              </div>
              <button
                disabled={Boolean(loading) || pdbId.length !== 4}
                onClick={() => fetchProtein(pdbId)}
              >
                {loading === pdbId ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Database size={15} />
                )}
                从 RCSB 获取
              </button>
            </div>

            <div className="recommend-heading">
              <div>
                <Sparkles size={15} />
                <strong>精选起始结构</strong>
              </div>
              <span>点击后自动下载并加入当前场景</span>
            </div>

            <div className="recommend-grid">
              {recommendations.map((item) => {
                const alreadyLoaded = workspace.structures.some(
                  (structure) =>
                    structure.filename.toUpperCase().startsWith(item.pdbId)
                );
                return (
                  <button
                    key={item.pdbId}
                    className="recommend-card"
                    disabled={Boolean(loading) || alreadyLoaded}
                    onClick={() => fetchProtein(item.pdbId)}
                  >
                    <div className="recommend-card-top">
                      <code>{item.pdbId}</code>
                      <span>{item.category}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <small>
                      {loading === item.pdbId ? (
                        <>
                          <LoaderCircle size={12} className="spin" />
                          正在下载
                        </>
                      ) : alreadyLoaded ? (
                        <>
                          <CheckCircle2 size={12} />
                          已在场景中
                        </>
                      ) : (
                        "载入这个结构 →"
                      )}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="hub-content combine-content">
            <div className="combine-explain">
              <GitCompareArrows size={19} />
              <div>
                <strong>选择两个场景对象</strong>
                <p>
                  “结构比对”会移动第二个对象使其与第一个对象重合；“合并对象”会新建一个包含两者的
                  PyMOL 对象。两项操作都会写入 PML 和版本历史。
                </p>
              </div>
            </div>
            {workspace.structures.length < 2 ? (
              <div className="combine-empty">
                <Atom size={27} />
                <strong>还需要一个结构</strong>
                <p>先从推荐库或 RCSB 再载入一个蛋白，然后回来进行比对或合并。</p>
                <button onClick={() => setTab("library")}>去获取结构</button>
              </div>
            ) : (
              <>
                <div className="object-pair">
                  <ObjectSelect
                    label="参考对象（保持不动）"
                    value={firstId}
                    structures={workspace.structures}
                    onChange={setFirstId}
                  />
                  <span className="pair-arrow">←</span>
                  <ObjectSelect
                    label="移动 / 合并对象"
                    value={secondId}
                    structures={workspace.structures}
                    onChange={setSecondId}
                  />
                </div>
                <div className="combine-actions">
                  <button
                    onClick={() => commitPair("align")}
                    disabled={Boolean(loading) || firstId === secondId}
                  >
                    {loading === "align" ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <GitCompareArrows size={16} />
                    )}
                    结构比对
                    <span>使用 PyMOL align</span>
                  </button>
                  <button
                    onClick={() => commitPair("merge")}
                    disabled={Boolean(loading) || firstId === secondId}
                  >
                    {loading === "merge" ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <GitMerge size={16} />
                    )}
                    合并为新对象
                    <span>保留原始对象</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ObjectSelect({ label, value, structures, onChange }) {
  return (
    <label className="object-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {structures.map((structure) => (
          <option key={structure.id} value={structure.id}>
            {structure.objectName} · {structure.format.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
