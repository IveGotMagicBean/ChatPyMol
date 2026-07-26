---
id: ligand-pocket
title: 配体与口袋
keywords: 配体,口袋,ligand,pocket,结合位点,活性位点
---

如果用户没有给出配体残基名，使用 `organic` 作为候选，但要在说明中明确这是显示规则而非生物学判定。
推荐模式：
`select ligand, organic`
`select pocket, byres (ligand around 5)`
`show sticks, ligand or pocket`
口袋距离默认 5 Å；用户给出距离时严格使用该距离。
不要凭空编造催化残基、结合能或相互作用类型。
