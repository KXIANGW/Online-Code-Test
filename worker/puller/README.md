# Language Rootfs Puller

`language-rootfs-puller` 是每節點服務，負責為基於 isolate 的評測 Worker 準備語言 rootfs 目錄樹。在 Kubernetes 中以 DaemonSet 運行，拉取 OCI 映像，將其解包至 `/var/lib/oct/rootfs`，並為每個語言維護穩定的符號連結。

## 運作原理

```text
OCI 映像 Registry
       |
       | 以 skopeo/umoci 方式拉取並解包
       v
節點 hostPath: /var/lib/oct/rootfs/<lang>-<digest>/
節點 hostPath: /var/lib/oct/rootfs/<lang> -> <lang>-<digest>
       |
       | 唯讀掛載
       v
Worker Pod: isolate --chroot=/var/lib/oct/rootfs/<lang>
```

更新是原子性的：新的 digest 先解包至版本目錄，再交換語言符號連結。進行中的 isolate 執行繼續使用舊的 inode，後續執行則使用新的 rootfs。舊版本目錄在下次調和（reconcile）時清除。

## 調和模式

| 模式 | 觸發條件 |
| --- | --- |
| Eager | 服務啟動時 |
| Poll | `POLL_INTERVAL_MS` 間隔，預設 5 分鐘 |
| Reload | `POST /reload`，可選擇以 `X-Reload-Token` 保護 |

## 端點

- `GET /healthz` - 健康探測。
- `POST /reload` - 觸發立即調和。

## 環境變數

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `LANGUAGES_FILE` | `/config/languages.yaml` | 從 ConfigMap 掛載的語言規格 |
| `ROOTFS_BASE_DIR` | `/var/lib/oct/rootfs` | HostPath 目標目錄 |
| `PORT` | `8081` | HTTP 埠號 |
| `POLL_INTERVAL_MS` | `300000` | 輪詢間隔；`0` 停用輪詢 |
| `RELOAD_TOKEN` | 未設定 | 可選的 reload 共享金鑰 |

## 開發

```bash
npm install
npm run lint
npm test
npm run coverage
npm run build
```

陳述式、分支、函式與行數的測試覆蓋率須維持在 85% 以上。

單元測試模擬了 OCI 操作，因此不需要 `skopeo`、`umoci` 或 Registry 存取。部署清單位於 `../../charts/language-rootfs-puller`。
