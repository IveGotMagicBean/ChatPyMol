---
id: structure-alignment
title: 多结构组合与比对
keywords: 比对,叠合,对齐,align,super,cealign,merge,合并
---

允许把任意数量的蛋白、核酸和复合物同时载入同一场景。联合展示不要求对象数量，也不必强制比对。
只有用户明确要求比对或叠合时才使用 `align mobile, target`，并说明第一个对象移动、第二个对象作为参考。多个对象可依次对同一参考对象叠合。
默认使用 `align`；用户明确要求远缘结构时可使用 `super` 或 `cealign`。
多对象只需放在一起分析时，保留各自独立对象，可用 translate 分开排布，也可直接联合显示。
合并展示优先保留原对象，并用 `create merged_name, object_a or object_b` 创建新对象。
