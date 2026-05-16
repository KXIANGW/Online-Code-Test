# Redis 設定說明

## 用途

Redis 在本系統中扮演兩個角色：

1. **Cache-aside 加速讀取** — 語言列表、題目列表、題目詳情、使用者 profile 在首次查詢後寫入 Redis，後續請求直接從快取回傳，減少 PostgreSQL 壓力。
2. **Draft 自動儲存** — 候選人作答草稿（code + language）以 `session:draft:{sessionId}:{problemId}` 為 key 儲存至 Redis，TTL 與考試剩餘時間同步，考試結束後自動過期。

Redis **不是強依賴**：所有 cache 讀取失敗皆靜默降級至 DB；draft 儲存失敗時前端 localStorage 仍保有草稿，不影響考試流程。

---

## 設定檔（`redis.conf`）

```
maxmemory 256mb
maxmemory-policy volatile-lru
appendonly yes
```

| 設定 | 說明 |
|------|------|
| `maxmemory 256mb` | 記憶體上限；超過時依 policy 淘汰 |
| `maxmemory-policy volatile-lru` | 僅淘汰有設定 TTL 的 key（cache 與 draft 均有 TTL），永久 key 不受影響 |
| `appendonly yes` | 開啟 AOF 持久化，Redis 重啟後 draft 資料不遺失 |

---

## Cache Key 規格與 TTL

| Key 格式 | TTL | 說明 | 失效時機 |
|----------|-----|------|----------|
| `languages` | 3600s（1h） | 啟用語言列表 | 語言設定變更時呼叫 `cacheDel` |
| `problems:list` | 300s（5m） | 題目摘要列表 | 題目建立、更新、刪除、測資異動時 |
| `problem:{id}:raw` | 86400s（24h） | 單題完整資料（含測資）| 題目更新、測資異動、language limits 變更時 |
| `user:{id}` | 300s（5m） | 使用者 profile | 使用者更新、刪除時 |
| `session:draft:{sessionId}:{problemId}` | 考試剩餘秒數 | 候選人草稿（code + language）| 考試到期自動過期；`clearSessionDrafts` 取消時主動刪除 |

---

## 降級行為

| 場景 | 行為 |
|------|------|
| Redis 連線失敗（cache 讀取）| `catch(() => null)`，回 `null` 後直接查 DB |
| Redis 連線失敗（cache 寫入）| `catch(() => {})`，靜默忽略，下次查詢再重試 |
| Redis 連線失敗（draft 儲存）| 靜默忽略；前端 localStorage 仍保有 1s debounce 草稿 |
| Redis 連線失敗（draft 讀取）| 回傳空物件 `{}`；前端改從 localStorage 恢復 |

---

## 本地啟動（docker-compose）

Redis 透過 docker-compose 啟動，使用 `infra/redis/redis.conf` 掛載設定，連線位址由 `REDIS_URL` 環境變數注入後端（預設 `redis://localhost:6379`）。
