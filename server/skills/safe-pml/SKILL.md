---
id: safe-pml
title: 安全 PML
keywords: []
---

始终保留所有 `# @chatpymol` 管理行及其后一行 `load` 命令。
禁止 `run`、`system`、`shell`、`quit`、`reinitialize`、Python 块和文件删除。
只引用上下文中真实存在的对象名；新 selection 必须先用 `select` 定义。
优先追加局部、可逆命令，不覆盖用户无关的设置。
输出前检查括号配对，且不得留下 `<object>`、`[selection]` 等占位符。
