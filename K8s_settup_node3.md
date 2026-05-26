# K8s Node 3 Setup - Data / Monitoring Node

Node 3 是資料層與監控節點。建議內網 IP：

```text
192.168.50.205
```

Node 3 預期放置：

- `postgres`
- `rabbitmq`
- `redis`
- `prometheus`
- `grafana`
- `cadvisor`
- 必要 kube-system Pod

---

## 1. 基礎套件

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release jq git socat
```

確認 cgroup v2：

```bash
stat -fc %T /sys/fs/cgroup
# 預期：cgroup2fs
```


## 防火牆設定

實驗室重建階段建議先關閉 UFW，避免 k3s agent join、Flannel VXLAN、kubelet metrics 或 NodePort 被防火牆擋住。等三節點 cluster 與 OCT 都驗證完成後，再視需要重新啟用防火牆。

在 Node 3 (`192.168.50.205`) 執行：

```bash
sudo ufw status verbose
sudo ufw disable
sudo ufw status verbose
```

Node 3 是 agent；防火牆關閉後，它會主動連到 Node 1 的 `https://192.168.50.208:6443`。

若之後要重新啟用 UFW，至少要允許以下內網流量：

- Node 1: `6443/tcp` 允許 Node 2 / Node 3 連入。
- All nodes: `8472/udp` 允許三台 node 彼此連線，給 Flannel VXLAN。
- All nodes: `10250/tcp` 允許三台 node 彼此連線，給 kubelet / metrics server。
- All nodes: `31000/tcp` 允許內網或外部 reverse proxy 連入 frontend NodePort。

不要把 `8472/udp` 開到公網。

## 2. 從 Node 1 取得加入資訊

在 Node 1 執行：

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

Node 3 會用到：

```bash
K3S_URL="https://192.168.50.208:6443"
K3S_TOKEN="貼上 Node 1 輸出的 token"
```

確認 Node 3 可以連到 Node 1：

```bash
ping -c 3 192.168.50.208
curl -k https://192.168.50.208:6443/readyz
```

## 3. 安裝 k3s agent

先寫入 agent config：

```bash
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
kubelet-arg:
  - cgroup-driver=systemd
node-ip: 192.168.50.205
EOF
```

安裝 agent：

```bash
curl -sfL https://get.k3s.io | sudo env K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" sh -
```

驗證 agent：

```bash
systemctl is-active k3s-agent
sudo journalctl -u k3s-agent -n 80 --no-pager
```

## 4. 在 Node 1 設定 label

回到 Node 1 執行：

```bash
kubectl get nodes -o wide
```

找到 Node 3 的實際名稱後：

```bash
NODE3="填入 Node 3 的 kubectl node name"

kubectl label node "$NODE3" oct-role=data --overwrite
```

驗證：

```bash
kubectl get nodes --show-labels
```

## 5. Data workload 預期設定

以下 workloads 應加上：

```yaml
nodeSelector:
  oct-role: data
```

套用對象：

- `postgres`
- `rabbitmq`
- `redis`
- `prometheus`
- `grafana`

## 6. PVC 注意事項

目前專案中以下服務有 PVC：

| Service | PVC |
| --- | --- |
| PostgreSQL | `postgres-pvc` |
| RabbitMQ | `rabbitmq-pvc` |
| Redis | `redis-pvc` |
| Prometheus | `promdata-pvc` |
| Grafana | `grafanadata-pvc` |

如果是全新 cluster，可以直接讓 PVC 在 Node 3 建立。

若使用 local-path 類型的 ReadWriteOnce PVC，`nodeSelector: oct-role=data` 會讓 PVC 在 Node 3 首次綁定；既有 PVC 不會自動搬移。

如果是從既有單機 cluster 搬過來，請先備份：

```bash
kubectl -n oct exec postgres-0 -- pg_dump -U oct -d oct > oct-postgres-backup.sql
```

RabbitMQ/Redis 是否需要備份，取決於當下是否有未處理任務或重要 session cache。若不確定，請先停服務、確認 queue 清空，再搬移。

## 7. 驗證資料層 Pod

在 Node 1 執行：

```bash
kubectl -n oct get pods -o wide | grep -E 'postgres|rabbitmq|redis|prometheus|grafana'
```

預期這些 Pod 都在 Node 3。

檢查 Service：

```bash
kubectl -n oct get svc postgres rabbitmq redis prometheus grafana
```

## 8. 驗證 PostgreSQL

```bash
kubectl -n oct exec postgres-0 -- pg_isready -U oct -d oct
```

預期：

```text
accepting connections
```

## 9. 驗證 RabbitMQ

```bash
kubectl -n oct exec rabbitmq-0 -- rabbitmq-diagnostics ping
```

預期：

```text
Ping succeeded
```

## 10. 驗證 Redis

```bash
kubectl -n oct exec deploy/redis -- redis-cli ping
```

預期：

```text
PONG
```

## 11. 驗證監控

```bash
kubectl -n oct port-forward svc/prometheus 9090:9090
```

另一個 terminal：

```bash
curl 'http://localhost:9090/api/v1/query?query=up'
```

Grafana：

```bash
kubectl -n oct port-forward svc/grafana 3001:3000
```

瀏覽器開：

```text
http://localhost:3001
```

## 12. NodePort 驗證

即使 frontend Pod 不在 Node 3，kube-proxy 仍應該讓 Node 3 的 NodePort 可用：

```bash
curl -I http://192.168.50.205:31000
```

如果失敗，請檢查：

```bash
kubectl -n oct get svc frontend
sudo iptables-save | grep 31000
sudo systemctl status k3s-agent
```
