# Redis

Redis 作為盡力而為的輔助服務使用。當 Redis 不可用時，系統應繼續正常運作，快取未命中時回退至 PostgreSQL，草稿則回退至瀏覽器本地儲存。

## 用途

| 用途 | 說明 |
| --- | --- |
| Cache-aside 讀取 | 語言清單、題目與使用者資料在資料庫讀取後進行快取。 |
| 考試草稿 | 應試者的程式碼草稿依 Session、題目與語言儲存。 |
| WebSocket 事件匯流排 | 後端實例發布 Session 事件，讓連接至其他實例的訂閱者也能收到評測更新。 |

## 設定

`redis.conf`：

```conf
maxmemory 256mb
maxmemory-policy volatile-lru
appendonly yes
```

| 設定 | 用途 |
| --- | --- |
| `maxmemory 256mb` | 本地開發記憶體上限 |
| `maxmemory-policy volatile-lru` | 僅驅逐有 TTL 的 Key |
| `appendonly yes` | 在 Redis 重啟後保留草稿/快取狀態 |

## 索引鍵

| Key | TTL | 負責服務 |
| --- | --- | --- |
| `languages:list` | 3600s | `backend/src/services/language.service.ts` |
| `problems:list` | 300s | Problem service |
| `problem:{id}:raw` | 86400s | Problem service |
| `user:{id}` | 300s | User service |
| `session:draft:{sessionId}:{problemId}:{language}` | 考試剩餘秒數 | Draft service |
| `oct:ws:session-events` | Pub/sub 頻道 | WebSocket Session 事件匯流排 |

草稿的列出與刪除使用 `SCAN MATCH session:draft:{sessionId}:*`，讓一個 Session 可以在不知道完整 Key 集合的情況下，還原或清除所有已儲存語言的草稿。

## 降級行為

| 情境 | 行為 |
| --- | --- |
| 快取讀取失敗 | 回傳 `null` 並讀取 PostgreSQL |
| 快取寫入失敗 | 忽略，稍後請求時重試 |
| 草稿儲存失敗 | 忽略；前端 localStorage 仍保有草稿 |
| 草稿還原失敗 | 回傳 `{}` |
| WebSocket pub/sub 失敗 | 本地訂閱者仍可收到事件；跨實例廣播降級 |

## 本地使用

Docker Compose 將此目錄掛載至 Redis 容器。後端從環境變數讀取 `REDIS_URL`，在 Compose 中通常為 `redis://redis:6379`，本地主機測試則為 `redis://localhost:6379`。
