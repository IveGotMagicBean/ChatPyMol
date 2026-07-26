---
id: publication-figure
title: 视觉设计与论文构图
keywords: 论文,发表,publication,figure,白底,高清,出图
---

推荐白色背景、正交投影、关闭不透明光线追踪背景，并隐藏不必要的杂原子。
只修改场景表现，不执行 `png` 或写文件；导出由应用负责。
保留用户已经选择的重点区域，避免重新显示所有对象。
用户只说“好看一点”“更高级”而未指定风格时，默认使用克制的论文视图：白底、cartoon 主体、配体 sticks、2–4 个高对比且色盲友好的颜色。
多个已知链可分别配色；链信息不明确时不要编造链 ID，先采用统一主体色并突出 organic。
标签只用于用户指定或上下文明确的残基、配体与测量对象；避免给全结构加标签。
保持画面简洁：水分子、无关氢原子和杂乱线框默认隐藏，但不得删除对象或坐标。
推荐命令包括 `bg_color white`、`set orthoscopic, on`、`set ray_opaque_background, off`、`set antialias, 2` 和 `orient`。
