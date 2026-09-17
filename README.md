# JSON 三方合并台

一个纯本地的 JSON 三方合并工具（React + TypeScript + Vite）。粘贴或导入**基线（Base）**、**当前分支（Ours）**、**目标分支（Theirs）**三份 JSON，按 JSON Pointer 递归执行三方合并，在树形视图中定位并解决冲突，最终导出合并 JSON 与相对基线的 RFC 6902 补丁；输出阶段还可挂载一份 **JSON Schema（Draft 2020-12）**，使用 [Ajv](https://ajv.js.org/) 对合并结果做约束校验。冲突处理页可下载**会话快照**（三份源 JSON + 已选解决方案），之后从输入页导入即可恢复合并流程。

## 快速启动（Docker Compose，一条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

停止：`docker compose down`

## 本地开发

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产构建（输出 dist/）
npm run preview    # 预览生产构建 http://localhost:4173
npm test           # 运行合并逻辑单元测试（vitest）
```

## 操作方法

1. **输入三份 JSON**：在三个面板中分别粘贴或点击「导入文件」选择 `.json` 文件；可点击「加载示例数据」快速体验。点击「开始合并」。也可以点击「**导入会话快照**」直接恢复之前的合并流程（见下文「会话快照」）。
2. **解决冲突**：
   - 左侧合并树按 JSON Pointer 层级展示合并结果，冲突节点以红色标出，点击即可定位；
   - 右侧面板显示冲突的三方值（基线 / 当前 / 目标）与冲突原因，可选择「采用当前分支」「采用目标分支」，或填写自定义 JSON 值；
   - 顶部进度条显示已解决数量，全部解决后「生成合并结果」按钮可用；
   - 点击底部「**下载会话快照**」可将当前进度（三份源 JSON + 已选解决方案）保存为 `merge-session-snapshot.json`，便于稍后继续。
3. **导出结果**：查看合并后的 JSON 与相对基线的 RFC 6902 JSON Patch，支持一键复制或下载为 `merged.json` / `patch.json`。
4. **（可选）Schema 约束校验**：在输出页顶部勾选「JSON Schema 约束校验」：
   - 粘贴或「导入文件」载入一份 **Draft 2020-12** Schema，点击「应用 Schema」即对合并结果执行校验（支持文档内 `$ref` 与 `format` 等标准关键字）；
   - 错误按 **JSON Pointer（instancePath）分组**展示，每条显示关键字（keyword）、消息（message）与参数（params，如 `missingProperty`、`allowedValues`）；
   - 点击错误前的 **JSON Pointer 路径**，可直接在左侧合并结果视图中滚动并高亮对应值；
   - Schema JSON 解析失败、或包含**无法解析的本地 `$ref`** 时会给出明确错误提示，且**不会覆盖上一次有效的 Schema**（仍按旧 Schema 校验）；
   - 可随时取消勾选关闭校验；**开启校验且存在错误时仍允许下载**，下载按钮旁会显示「⚠ N 个校验错误」警示。

## 合并规则

按 JSON Pointer 逐节点递归比较三方：

| 情况 | 结果 |
| --- | --- |
| 仅一侧相对基线变化 | 采用变化的一侧 |
| 双方改成相同的值（含都删除） | 采用一次 |
| 双方改成不同的值 | **冲突** |
| 一侧删除、另一侧修改 | **冲突** |

- 只有**对象**会按键递归合并；**数组和标量均按单个值整体处理**（双方改同一数组即冲突）。
- 双方新增的对象会按键递归合并；一方删除、另一方修改对象时整体记为冲突。
- 冲突解决方式：采用当前分支 / 采用目标分支 / 自定义 JSON 值（可表示删除以外的任意值）。

## 输出说明

- **合并结果 JSON**：应用所有自动合并与冲突解决后的完整文档（带行号显示，便于按 JSON Pointer 定位）。
- **RFC 6902 补丁**：`基线 → 合并结果` 的 JSON Patch（`add` / `remove` / `replace`），路径按 RFC 6901 转义（`~` → `~0`，`/` → `~1`）。
- **Schema 校验**：可选的 Draft 2020-12 约束校验（Ajv，`allErrors` 模式），错误按 instancePath 分组，不阻断下载，仅在下载旁给出错误数警示。

## 会话快照

冲突处理页底部「⬇ 下载会话快照」会导出一份 `merge-session-snapshot.json`；在输入页点击「导入会话快照」选择该文件即可恢复合并流程。

### 快照格式（version 1）

```jsonc
{
  "format": "json-three-way-merge/session-snapshot", // 格式标识，固定值
  "version": 1,                                      // 格式版本
  "createdAt": "2026-09-17T12:00:00.000Z",           // 导出时间（ISO 8601，仅信息展示）
  "sources": {                                       // 三份源 JSON，导入时据此重新合并
    "base":   { "gone": 5 },
    "ours":   {},
    "theirs": { "gone": 6 }
  },
  "resolutions": [                                   // 已选解决方案（未选择的冲突不记录）
    {
      "pointer": "/gone",                            // 冲突的 JSON Pointer（RFC 6901）
      "base":   { "kind": "value", "value": 5 },     // 三方值指纹，用于导入时核对
      "ours":   { "kind": "absent" },                // absent 表示该侧已删除/不存在
      "theirs": { "kind": "value", "value": 6 },
      "resolution": { "kind": "ours" }               // ours / theirs / { "kind": "custom", "value": … }
    }
  ]
}
```

- 侧值编码：`{ "kind": "value", "value": <任意 JSON> }` 或 `{ "kind": "absent" }`（该侧已删除）。
- 解决方案编码：`{ "kind": "ours" }`、`{ "kind": "theirs" }` 或 `{ "kind": "custom", "value": <任意 JSON> }`。

### 导入与恢复规则

1. 导入时先用快照中的 `sources` **重新执行一次三方合并**，绝不沿用快照里的合并结果；
2. 对快照中的每条解决方案，按 **JSON Pointer** 在新合并结果的冲突列表中查找对应冲突（**不按旧冲突序号套用**，冲突顺序变化不影响恢复）；
3. 仅当该冲突的 **base / ours / theirs 三方值均与快照中的指纹一致**时才恢复此选择；
4. 其余条目跳过并汇总原因（路径已无冲突、某侧值已变化、重复条目等）；
5. 完成后在冲突处理页显示「恢复 N 项 / 跳过 M 项」及跳过明细，并自动定位到**首个未解决的冲突**。

快照**结构或字段非法**（JSON 语法错误、`format` 不识别、`version` 过新、缺少 `sources`/`resolutions` 字段、条目字段不合法等）时，在输入页显示具体错误，且**不会覆盖当前会话**（已输入的内容保持不变）。

## 项目结构

```
src/
├── merge/                  # 与 UI 无关的核心逻辑
│   ├── threeWayMerge.ts    # 三方合并（生成合并树 + 冲突列表）
│   ├── rfc6902.ts          # 基线 → 结果的 JSON Patch 生成
│   ├── pointer.ts          # RFC 6901 JSON Pointer 工具
│   ├── schema.ts           # Ajv Draft 2020-12 编译 / 校验 / 错误分组
│   ├── snapshot.ts         # 会话快照：构建 / 校验解析 / 按指针+三方值恢复
│   ├── jsonLineMap.ts      # JSON Pointer → 结果视图行号映射（点击定位）
│   ├── deepEqual.ts        # 键序无关的深比较
│   └── *.test.ts           # 单元测试（vitest）
├── components/             # 输入 / 合并树 / 冲突面板 / 输出 / Schema 面板等界面组件
├── download.ts             # 浏览器下载辅助
└── App.tsx                 # 三阶段流程编排
```
