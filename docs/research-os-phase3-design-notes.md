# Research OS Phase 3 设计备注

本文只记录 Phase 3 / Phase 3.5 架构预审后的约束，不代表已经实现。

## 1. Conversation 与 Topic 的关系

- 创建 Conversation 的界面可以继续要求用户选择 Primary Topic（主要主题），以帮助用户在保存时完成整理。
- 数据库层不应永久禁止无 Topic 的 Conversation。
- 后续需要支持 Capture Inbox（捕获收件箱），也就是“先保存，稍后整理”。

## 2. Capture 来源适配器版本

- Conversation Capture（对话捕获）需要保存来源适配器及其版本，例如 `chatgpt-dom-v1`。
- 不保存原始完整网页 HTML。
- 适配器版本用于解释数据是按哪一套页面结构提取的，方便网页变化后的排查与迁移。

## 3. 正式保存前的数据库备份

- Phase 3 在首次正式保存真实 Conversation 前，必须提供最基本的手工一致性完整数据库备份能力。
- “一致性”意味着备份文件代表数据库某一个完整时间点，不能只复制正在写入中的半成品文件。
- 具体实现、界面和恢复流程留到 Phase 3 施工方案中确定；P2.5 不创建 migration，也不修改数据库结构。
