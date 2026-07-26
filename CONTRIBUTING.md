# 贡献指南

感谢你改进 ChatPyMOL。功能建议可以先提交 [Issue](https://github.com/IveGotMagicBean/ChatPyMol/issues/new?template=suggestion.yml)，便于确认科研场景、交互边界和兼容性。

## 开发环境

要求 Node.js 22+。

```bash
git clone git@github.com:IveGotMagicBean/ChatPyMol.git
cd ChatPyMol
cp .env.example .env
npm ci --ignore-scripts
npm run dev
```

不要把真实 API Key、设备令牌、患者/受试者信息、未公开结构或服务器 `data/` 目录加入 commit。

## 提交修改

1. 从最新 `main` 创建短生命周期分支；
2. 保持改动聚焦，并为数据契约、并发或 PML 逻辑补测试；
3. UI 改动同时检查亮/暗主题、中/英文、左右栏收起和常见屏幕宽度；
4. PyMOL 交互改动必须在真实 WASM 渲染器中验证，不能只用静态图片；
5. 提交前执行：

```bash
npm test
npm run build
npm pack --dry-run
```

## 设计约束

- PyMOL 经典 A/S/H/L/C 原生栏布局应保持可见、可用；
- 人工操作、浏览器 AI、CLI 和 MCP 必须共享同一版本链；
- 每次写入必须明确 Session、基准版本和至少一个目标对象；
- 支持任意数量对象，不得加入“必须恰好两个对象”的限制；
- 版本冲突必须阻断并返回最新版本，不得静默覆盖；
- 后台 Session 更新不得擅自切换用户当前视图；
- 新日志与错误信息不得输出 bearer token 或模型密钥。

## 第三方文件

不要直接覆盖稳定 PyMOL-WASM wheel。实验 wheel 应使用不同文件名，并通过 `VITE_PYMOL_WHEEL` 显式选择。更新第三方二进制时，请同时更新来源、版本、校验信息和 `THIRD_PARTY_NOTICES.md`。
