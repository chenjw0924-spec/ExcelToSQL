# Excel / CSV 转 SQL 脚本工具 (纯前端版)

这是一个轻量级、高性能的在线工具，主要用于将外部的 Excel (`.xlsx`, `.xls`) 或 `.csv` 文件快速转换为多数据库方言支持的 `SQL INSERT` 脚本。
该项目完全采用**纯前端架构**，所有文件读取、解析及 SQL 生成都在浏览器端完成，无需后端交互，保证了数据的隐私与安全。

## 🌟 核心特性

- **纯前端处理**：采用 `SheetJS (xlsx)` 加载和解析数据，无服务器中转，数据绝对安全。
- **多格式支持**：兼容 `.xlsx`, `.xls`, `.csv` 文件拖拽及点击上传。
- **多工作表(Sheet)选择**：支持一键选中一个或多个工作表，合并生成对应的数据库表 SQL 脚本。
- **多数据库方言**：内置支持 MySQL, SQL Server, PostgreSQL, Oracle, 达梦数据库(DM) 的语法与内置类型差异。
- **分批生成(Batch Insert)**：针对大数据量进行自动分批（每 1000 条数据一个批次），防止单个 `INSERT` 语句超出数据库限制。
- **自动建表(CREATE TABLE)指令**：可勾选是否包含安全建表脚本（例如 `IF NOT EXISTS` 或 `IF OBJECT_ID IS NULL` 等）。
- **字段类型推断支持与转义**：
  - 自动处理和转义字符串内的单引号 (`'`) 成 `''`。
  - 根据不同的数据库动态赋予基础的数据类型（如 SQL Server 默认 `NVARCHAR(MAX)`，PostgreSQL 默认 `TEXT` 等）。
- **实时响应与导出**：一键复制或直接导出为 `.sql` 文件以供本地使用。

## 🛠 技术栈

- **框架**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **样式**: [Tailwind CSS v4](https://tailwindcss.com/)
- **核心解析引擎**: [SheetJS (xlsx)](https://sheetjs.com/)
- **图标组件库**: [Lucide React](https://lucide.dev/)

## 📂 核心代码结构解析

这个项目采用了简单的单页面全栈化架构，最主要的业务逻辑都在 `src/App.tsx` 文件中。

### 1. 状态管理 (React `useState`)
- `file`, `workbook`: 存放上传的原始内容及 SheetJS 转换后的 Workbook 对象。
- `activeSheets`: 用户勾选的拟转换的工作表集合。
- `tableNames`: 一个映射字典，记录 `Sheet名称 -> 对应的目标表名`，方便用户自定义。
- `dialect`: 目标 SQL 方言标识。
- `includeCreateTable`: 控制是否追加 `CREATE TABLE` 语句的布尔状态。
- `sqlOutput`: 最终在右侧 Textarea 展示输出的完整 SQL 字符串。

### 2. 文件解析与数据提取

依赖于 `SheetJS` 提供的接口：
```typescript
const wb = XLSX.read(data, { type: 'array', cellDates: true });
// 读取内容之后
const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: null });
```
通过 `{ header: 1, defval: null }` 配置，我们将每个 Sheet 转换为标准的二维数组，空值显式填为 `null`，以便更方便地生成 SQL 文件里的 `NULL` 参数。

### 3. 多方言 SQL 生成设计机制

生成逻辑主要放置在 `useEffect` 中，依赖于用户配置的状态自动重新生成：

- **表名与字段的安全处理 (`quoteId` 函数)**：
  - MySQL 采用 \`反引号\` 包装。
  - SQL Server 采用 `[方括号]`。
  - Oracle / PostgreSQL / DM 采用 `"双引号"`。
- **表建立判断逻辑**:
  - `SQL Server`: 使用 `IF OBJECT_ID(..., N'U') IS NULL`
  - `Oracle`: 使用匿名 PL/SQL 块 `BEGIN ... EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 ...`
  - `MySQL / Postgres`: 使用 `CREATE TABLE IF NOT EXISTS`
- **分片循环**:
  将全量的二维数组拆分成 `batchSize = 1000` 的子数组进行独立组装：
  - **Oracle**: 使用 `INSERT ALL INTO ... SELECT 1 FROM DUAL;` 语法格式。
  - **通用**: 采用标准的 `INSERT INTO ... VALUES (...), (...);` 格式。

## 🚀 本地开发与运行

1. 安装依赖:
   ```bash
   npm install
   ```
2. 启动开发服务器:
   ```bash
   npm run dev
   ```
3. 构建生产版本:
   ```bash
   npm run build
   ```

## 📝 维护指南与功能扩展思路

未来如果要丰富这个工具，可以从以下维度下手：
1. **类型精细推断**: 根据前 N 行数据的数据特征（是否全部为数字、是否是标准的 ISO 日期），推断出更准确的目标表类型（如 `INT`, `DATETIME` 等）以替代暴力的全 `VARCHAR/TEXT`。
2. **大型文件支持 (Web Worker)**: 当 Excel 数据达到百万量级时，JS 主线程直接 `for` 循环拼接大文本会导致浏览器明显卡顿甚至 Crash。可以考虑将解析及 SQL 拼接抽取到单独的 Web Worker 中实现。
3. **主键与索引设定**: 增加界面交互让用户勾选某列为主键。

---
*Created automatically by the AI build agent. Modify this document to reflect your updates.*
