# 同步助手 (Sync Assistant) 设计文档

## 1. 总体目标

同步助手旨在为 Paper Burner 应用提供一个可选的本地后端服务，其核心目的是：

-   **数据持久化与备份**：将浏览器端（localStorage, IndexedDB）存储的关键数据以及应用处理产生的核心内容（如分块文本、OCR结果、Agent处理结果等）同步到用户本地的数据库中。
-   **防止数据丢失**：浏览器存储有被用户意外清除或因浏览器策略限制而丢失的风险，本地同步提供了一层额外保障。
-   **数据可访问性与迁移**：本地存储的数据理论上可以被用户直接访问或用于迁移到其他设备/环境（配合未来的导入导出功能）。
-   **增强应用能力**：为未来可能需要本地计算资源或访问本地文件系统的功能（如本地OCR、本地模型运行）打下基础。

此同步助手为可选组件，如果用户未运行或未配置，Paper Burner 应用仍能独立运行，但数据将仅存储于浏览器。

## 2. 架构设计

同步助手采用客户端-服务器 (C/S) 架构，其中 Paper Burner 前端作为客户端，本地运行的 Python 程序作为服务器。

### 2.1. 前端 (Paper Burner - 浏览器端)

-   **助手检测**:
    -   应用启动时，尝试通过预定义的本地端口（例如 `http://localhost:12345` 或 `ws://localhost:12345`）与本地同步助手建立连接。
    -   定期或在特定操作（如保存重要数据）前进行连接状态检查。
    -   UI 界面应有明确的指示，告知用户同步助手的连接状态（例如：已连接、未连接、连接中、连接失败）。
-   **连接方式**:
    -   优先考虑 **WebSocket**：实现长连接，方便双向通信和实时状态更新。
    -   备选 **HTTP(S) 长轮询/SSE**：如果 WebSocket 实现复杂或受限，可考虑。
-   **数据发送逻辑**:
    -   **触发时机**:
        -   定期批量同步（例如每隔几分钟）。
        -   在关键数据发生变化后立即/延迟同步（例如：保存新的处理结果、API Key变更、新增高亮标注）。
        -   用户手动触发"立即同步"操作。
    -   **数据封装**: 将需要同步的数据（如 `localStorage` 的特定条目、`IndexedDB` 的记录、Orama索引的序列化数据）封装成定义好的JSON格式。
    -   **差异同步 (可选，高级)**: 初期可以采用全量覆盖或基于时间戳的增量同步，未来可考虑更复杂的差异比对同步以减少数据传输量。
-   **API 调用**: 前端将通过 WebSocket 消息或 HTTP 请求调用后端定义的 API 接口来发送数据。

### 2.2. 后端 (同步助手 - Python 程序)

-   **服务器实现**:
    -   使用 Python Web 框架，如 **FastAPI** (推荐，性能高，异步支持好，数据校验方便) 或 Flask。
    -   **WebSocket 服务**: 如果选择 WebSocket，需要实现 WebSocket 服务器逻辑。
    -   **HTTP API 端点**: 定义 RESTful API 端点来接收和处理来自前端的同步请求。
-   **监听端口**: 监听一个本地端口 (例如 `12345`)，确保该端口不易与其他常用应用冲突。
-   **数据接收与处理**:
    -   接收前端发送的 JSON 数据。
    -   根据数据类型（例如 `localStorage_item`, `indexeddb_record_results`, `orama_index` 等）调用相应的处理模块。
    -   将数据存入本地数据库。
-   **数据存储逻辑**:
    -   见"5. 本地数据库选择"。
    -   需要处理数据的插入、更新。删除操作可以标记删除或真实删除。
-   **并发与队列 (可选)**: 对于大量数据的写入，可以考虑使用任务队列（如 Celery，或 Python 内置的 `asyncio.Queue`）来异步处理，避免阻塞主服务线程。

## 3. 同步的数据范围

同步助手旨在覆盖应用中的核心持久化数据和用户生成内容：

### 3.1. 浏览器存储 (`localStorage`)

由 `js/storage/storage.js` 管理的 `localStorage` 条目：

-   **用户设置**: `userSettings` (包含默认处理选项、UI偏好等)
-   **已处理文件记录**: `processedFilesRecord`
-   **API Key 及模型配置**: `modelKeys` (包含各模型/源站的API Key列表、状态、备注等)
-   **自定义源站配置**: `paperBurnerCustomSourceSites` (用户添加的自定义API源站点及其配置)
-   **最近成功使用的Key记录**: `paperBurnerLastSuccessfulKeys`
-   **(其他)** 任何未来新增的、需要持久化的全局配置。

*同步策略：通常可以采用覆盖式更新。*

### 3.2. 浏览器数据库 (`IndexedDB`)

由 `js/storage/storage.js` 管理的 `ResultDB` 数据库：

-   **`results` 对象存储区**:
    -   包含PDF处理结果的完整记录 (元数据、提取的文本、翻译、摘要、分块内容、OCR识别结果等)。
    -   每个文件处理结果对应一条记录。
-   **`annotations` 对象存储区**:
    -   用户对文档进行的高亮和批注信息。
    -   每条标注对应一条记录，关联到特定的文档ID。
-   **Orama 索引数据**:
    -   如果 `RetrievalAgent` 使用 Orama 并通过 `@orama/plugin-data-persistence` 将索引持久化（例如序列化为 JSON 或其他格式存储在 `localStorage` 或 `IndexedDB` 的特定键下），这部分序列化后的索引数据也需要同步。

*同步策略：可以基于记录ID进行增量同步（新增、更新）。删除操作需要前端通知后端。*

### 3.3. Agent 处理的中间/最终产物

-   **`LongTextAgent` 的"精简内容树"**: 如果此树结构被缓存（例如在 IndexedDB 或 localStorage），则需要同步。
-   其他由 Agents 生成的、有价值且需要跨会话保留的结构化数据。

### 3.4. 未来可能的 MCP (Model Context Protocol) 配置

-   用户配置的 MCP 服务器地址、认证信息、可用工具列表等。

## 4. 通信协议与数据格式

-   **主要通信协议**: WebSocket。
-   **备选/辅助通信协议**: HTTP/HTTPS (用于简单的状态检测或一次性数据传输)。
-   **数据交换格式**: **JSON**。
-   **消息结构 (WebSocket 示例)**:
    ```json
    {
      "type": "sync_data", // 消息类型: sync_data, status_request, ack, error
      "payload": {
        "dataType": "localStorage_item", // 例如: localStorage_item, indexeddb_results_record, indexeddb_annotations_record, orama_index_chunk
        "key": "userSettings", // dataType 为 localStorage_item 时使用
        "data": { ... } // 实际数据对象或序列化的索引块
      },
      "timestamp": "2023-10-27T10:30:00Z",
      "messageId": "unique_message_id" // 用于追踪和确认 (ack)
    }
    ```
-   **HTTP API 端点 (示例)**:
    -   `POST /sync/localStorage`: 同步 localStorage 条目。
    -   `POST /sync/indexeddb/results`: 同步 IndexedDB results 表的单条/多条记录。
    -   `POST /sync/orama_index`: 同步 Orama 索引。
    -   `GET /status`: 获取同步助手状态。

## 5. 本地数据库选择 (Python 后端)

-   **首选**: **SQLite**
    -   **优点**: 轻量级、单文件数据库、无需单独的服务进程、Python 内置支持 (`sqlite3` 模块)、易于部署和备份。对于单用户桌面应用场景非常合适。
    -   **缺点**: 高并发写入性能一般（但对于单用户同步场景通常足够）。
-   **备选**:
    -   **TinyDB**: 如果数据结构非常简单且不需复杂查询，是一个更轻量级的纯 Python JSON 文档数据库。
    -   **PostgreSQL/MySQL**: 如果未来有更复杂的数据关系、查询需求或多用户可能（虽然目前不像），可以考虑，但会增加部署复杂性。
-   **表结构设计 (SQLite 示例)**:
    -   `local_storage_data`:
        -   `key` (TEXT, PRIMARY KEY)
        -   `value` (TEXT) -- 存储 JSON 字符串
        -   `last_synced_timestamp` (DATETIME)
    -   `indexeddb_results`:
        -   `id` (TEXT, PRIMARY KEY) -- 对应 IndexedDB 中的 `id`
        -   `doc_hash` (TEXT) -- 文件内容的哈希，用于关联
        -   `metadata_json` (TEXT)
        -   `content_text` (TEXT)
        -   `translation_json` (TEXT)
        -   `summary_json` (TEXT)
        -   `chunks_json` (TEXT)
        -   `ocr_results_json` (TEXT)
        -   `created_at` (DATETIME)
        -   `updated_at` (DATETIME)
        -   `last_synced_timestamp` (DATETIME)
    -   `indexeddb_annotations`:
        -   `id` (TEXT, PRIMARY KEY)
        -   `doc_id` (TEXT, FOREIGN KEY references indexeddb_results(id)) -- 用于关联到具体文档
        -   `annotation_data_json` (TEXT) -- 存储高亮位置、评论等
        -   `created_at` (DATETIME)
        -   `updated_at` (DATETIME)
        -   `last_synced_timestamp` (DATETIME)
    -   `orama_indices`: (如果Orama索引可被拆分或版本化存储)
        -   `index_name` (TEXT, PRIMARY KEY) -- 例如 'main_document_index'
        -   `serialized_index_chunk` (BLOB/TEXT) -- 存储序列化后的Orama索引数据块
        -   `version` (INTEGER)
        -   `last_synced_timestamp` (DATETIME)
    -   `raw_content_store`: (可选，用于存储原始文件或大型文本块)
        -   `content_hash` (TEXT, PRIMARY KEY)
        -   `content_blob` (BLOB)
        -   `content_type` (TEXT) -- 例如 'pdf_chunk', 'ocr_page_text'
        -   `last_synced_timestamp` (DATETIME)

## 6. 错误处理与用户提示

-   **前端**:
    -   明确提示同步助手未连接、连接失败、同步中、同步成功、同步失败等状态。
    -   对于同步失败的条目，应有重试机制或将其标记并在下次同步时尝试。
    -   提供用户手动触发同步的选项。
-   **后端**:
    -   记录详细的错误日志。
    -   对接收到的数据进行基本校验，对非法数据返回错误响应。
    -   数据库写入失败时，应有错误处理和日志记录。

## 7. 安全性考虑

-   **本地端口访问**: 默认情况下，Python Web 服务 (如 FastAPI/Flask) 启动时会绑定到 `127.0.0.1` (localhost)，这意味着只接受来自本机的连接。这是基础的安全保障。
-   **跨域资源共享 (CORS)**: 如果使用 HTTP API，后端需要配置 CORS 策略，仅允许来自 Paper Burner 前端源的请求（如果前端通过 `file://` 或特定开发服务器运行，需要相应配置）。WebSocket 通常不受标准CORS策略的严格限制，但仍需注意来源验证。
-   **数据校验**: 对前端传入的数据进行严格的格式和类型校验，防止潜在的注入或数据损坏。FastAPI 的 Pydantic 模型在这方面非常有用。
-   **无敏感操作**: 同步助手主要负责数据存储，不应执行任何破坏性的本地系统操作。
-   **用户确认 (可选)**: 首次连接或进行重大数据同步操作时，可考虑在前端向用户请求确认。

## 8. 未来展望

-   **双向同步**: 实现从本地数据库恢复数据到新的浏览器环境或覆盖当前浏览器数据的功能。
-   **选择性同步**: 允许用户选择哪些类型的数据需要同步。
-   **云同步集成**: 允许用户将本地同步助手数据库进一步备份/同步到他们选择的云存储服务 (如 Google Drive, Dropbox, S3，通过rclone等工具或API)。
-   **版本历史 (高级)**: 对某些关键数据（如处理结果的文本内容）提供版本历史记录和回滚能力。
-   **加密 (高级)**: 对本地存储的敏感数据提供可选的加密层。
-   **作为本地 MCP Server 的一部分**: 同步助手可以与本地MCP Server集成，统一管理本地AI能力和数据。

这个设计文档为构建一个强大的本地同步助手奠定了基础。