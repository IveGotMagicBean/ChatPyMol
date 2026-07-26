# 第三方软件与归属声明

ChatPyMOL 根目录的 MIT License 只覆盖本项目贡献者编写的原创代码。仓库中随附或动态使用的第三方组件继续遵循各自许可证。

## Open-Source PyMOL 与 PyMOL-Wasm

- 组件：Open-Source PyMOL 2.6 的 WebAssembly wheel
- 文件：`public/pymol-wasm/pymol-2.6.0a0-cp39-cp39-emscripten_3_1_46_wasm32.whl`
- 移植项目：[yakomaxa/PyMOL-Wasm](https://github.com/yakomaxa/PyMOL-Wasm)
- 上游项目：[schrodinger/pymol-open-source](https://github.com/schrodinger/pymol-open-source)
- 许可证：Open-Source PyMOL 自有宽松许可证；PyMOL-Wasm 的前端部分按其上游说明为 MIT

PyMOL wheel 内的 `pymol-2.6.0a0.dist-info/LICENSE` 保留了原始许可证与商标声明；仓库同时提供可直接阅读的副本：[third_party/licenses/OPEN_SOURCE_PYMOL.txt](third_party/licenses/OPEN_SOURCE_PYMOL.txt)。

ChatPyMOL 是独立社区项目，不是 Schrödinger, LLC 的官方产品，也未获得其背书。PyMOL 是 Schrödinger, LLC 的商标。

## Pyodide

- 组件：Pyodide 0.22.1
- 文件：`public/pyodide/`
- 上游项目：[pyodide/pyodide](https://github.com/pyodide/pyodide)
- 许可证：Apache License 2.0

许可证副本：[third_party/licenses/APACHE-2.0.txt](third_party/licenses/APACHE-2.0.txt)。

## NumPy

- 组件：NumPy 1.23.5 的 Emscripten wheel
- 文件：`public/pyodide/numpy-1.23.5-cp310-cp310-emscripten_3_1_27_wasm32.whl`
- 上游项目：[numpy/numpy](https://github.com/numpy/numpy)
- 许可证：BSD-3-Clause

wheel 内保留 `numpy/LICENSE.txt` 与 `numpy-1.23.5.dist-info/LICENSE.txt`。

## Patinae

- 组件：Patinae Web bundle 0.4.4
- 文件：`vendor/patinae/`
- 上游项目：[zmactep/patinae](https://github.com/zmactep/patinae)
- 许可证：BSD-3-Clause

完整许可证位于 `vendor/patinae/pkg/LICENSE`。它仅作为旧版 WebGPU 回退适配器保留，不是当前默认渲染器。

## 其他 npm 依赖

React、Vite、Express、Model Context Protocol SDK、Lucide、Zod 等 npm 依赖的名称、精确版本与依赖树记录在 `package-lock.json`。它们各自的许可证随安装包分发，使用与再分发时应继续遵守对应条款。

如发现归属、版本或许可证记录有误，请通过 [Issue](https://github.com/IveGotMagicBean/ChatPyMol/issues) 或邮件 `542058929@qq.com` 联系维护者。
